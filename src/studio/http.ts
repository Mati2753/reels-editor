import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

export async function body(req: IncomingMessage, max = 128_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "The request is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function acceptUpload(req: IncomingMessage, file: string) {
  const max = 512 * 1024 * 1024;
  if (Number(req.headers["content-length"]) > max) throw new HttpError(413, "Choose a video under 512 MB.");
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _, done) {
      size += chunk.length;
      done(size > max ? new HttpError(413, "Choose a video under 512 MB.") : null, chunk);
    },
  });
  await pipeline(req, limit, createWriteStream(file, { flags: "wx" }));
}

const mime: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".css": "text/css",
  ".js": "text/javascript",
  ".html": "text/html",
  ".json": "application/json",
};

export async function serveFile(req: IncomingMessage, res: ServerResponse, file: string, download?: string) {
  const info = await stat(file);
  if (!info.isFile()) throw new HttpError(404, "File not found.");
  const headers: Record<string, string | number> = {
    "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download}"`;
  const range = req.headers.range;
  let start = 0;
  let end = info.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
    } else start = info.size;
    if (start > end || start < 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
      return;
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  }
  res.writeHead(range ? 206 : 200, { ...headers, "Content-Length": end - start + 1 });
  if (req.method === "HEAD" || !info.size) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
