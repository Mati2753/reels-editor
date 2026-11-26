// The frontal cascade runs on anonymous luma frames. Low support or competing faces leave the crop centered.
export async function locateFaces(core, run, media, asset) {
  if (!self.pico) importScripts(new URL("assets/vision/pico.js", self.location.href).href);
  const classify = self.pico.unpack_cascade(new Int8Array(await asset("vision/facefinder.bin")));
  const { width: w, height: h } = media.meta.video;
  // The 384px proxy retains aspect ratio. Limit the entire batch to 160 sampled pictures.
  const width = Math.max(2, Math.round((384 * w) / Math.max(w, h))),
    height = Math.max(2, Math.round((384 * h) / Math.max(w, h)));
  const rate = Math.min(3, 160 / media.duration);
  run([
    "-i",
    media.input,
    "-an",
    "-vf",
    "fps=" + rate + ",scale=" + width + ":" + height,
    "-pix_fmt",
    "gray",
    "-threads",
    "1",
    "-f",
    "rawvideo",
    "faces.gray",
  ]);
  const bytes = core.FS.readFile("faces.gray");
  core.FS.unlink("faces.gray");
  const stride = width * height,
    centers = [];
  for (let frame = 0; frame < Math.floor(bytes.length / stride); frame++) {
    const det = self.pico.run_cascade(
      { pixels: bytes.subarray(frame * stride, (frame + 1) * stride), nrows: height, ncols: width, ldim: width },
      classify,
      { shiftfactor: 0.1, minsize: 24, maxsize: Math.min(width, height), scalefactor: 1.1 },
    );
    const hits = self.pico
      .cluster_detections(det, 0.2)
      .filter((box) => box[3] >= 50)
      .sort((a, b) => b[3] - a[3]);
    if (!hits.length || (hits[1] && hits[1][3] > hits[0][3] * 0.6)) continue;
    const [row, col, size, score] = hits[0];
    centers.push({
      at: frame / rate,
      x: col / width,
      y: row / height,
      width: size / width,
      height: size / height,
      score,
    });
  }
  return { centers, rate, frames: Math.floor(bytes.length / stride), detector: "pico-frontal" };
}
export function framingPoints(faces, start, end) {
  if (!faces) return [];
  const rows = faces.centers.filter((p) => p.at >= start && p.at < end);
  if (rows.length < 2 || rows.length < 0.7 * (end - start) * faces.rate) return [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].at - rows[i - 1].at > 2.1 / faces.rate || Math.abs(rows[i].x - rows[i - 1].x) > 0.25) return [];
  }
  return rows;
}
