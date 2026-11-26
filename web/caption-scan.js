// Isolate outlined glyphs on a busy background. The detector receives geometry and ink, never the caption text.
export function captionScan(pixels, width, height, guide) {
  const top = Math.max(0, Math.floor(height * (guide.center - 0.075)));
  const bottom = Math.min(height, Math.ceil(height * (guide.center + 0.075)));
  const band = bottom - top;
  if (band < 8) return null;
  const ink = (guide.ink || "#ffffff").match(/[0-9a-f]{2}/gi)?.map((hex) => parseInt(hex, 16));
  if (ink?.length !== 3) return null;
  const dark = ink[0] + ink[1] + ink[2] < 250;
  const stride = width + 1,
    sums = new Uint32Array(stride * (band + 1));
  for (let y = 0; y < band; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = ((top + y) * width + x) * 4;
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      row += Number(dark ? Math.min(r, g, b) > 160 : Math.max(r, g, b) < 110);
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const mask = new Uint8Array(width * band),
    columns = new Uint16Array(width);
  const radius = Math.max(2, Math.round(Math.min(width, height) / 90));
  for (let y = 0; y < band; y++)
    for (let x = 0; x < width; x++) {
      const i = ((y + top) * width + x) * 4;
      if (
        Math.abs(ink[0] - pixels[i]) >= 75 ||
        Math.abs(ink[1] - pixels[i + 1]) >= 75 ||
        Math.abs(ink[2] - pixels[i + 2]) >= 75
      )
        continue;
      const left = Math.max(0, x - radius),
        right = Math.min(width, x + radius + 1);
      const upper = Math.max(0, y - radius),
        lower = Math.min(band, y + radius + 1);
      if (
        sums[lower * stride + right] -
          sums[upper * stride + right] -
          sums[lower * stride + left] +
          sums[upper * stride + left] ===
        0
      )
        continue;
      mask[y * width + x] = 1;
      columns[x]++;
    }
  const groups = [];
  for (let x = 0; x < width; x++) {
    if (columns[x] < 2) continue;
    const last = groups.at(-1);
    if (last && x - last.end < Math.max(8, width * 0.025)) {
      last.end = x;
      last.count++;
    } else groups.push({ start: x, end: x, count: 1 });
  }
  const score = (g) => g.count - 0.8 * Math.abs((g.start + g.end - width) / 2);
  const group = groups.sort((a, b) => score(b) - score(a))[0];
  if (!group || group.count < 7) return null;
  let first = band,
    last = -1;
  for (let y = 0; y < band; y++) {
    let matches = 0;
    for (let x = group.start; x <= group.end; x++) matches += mask[y * width + x];
    if (matches >= 2) {
      first = Math.min(y, first);
      last = y;
    }
  }
  if (last - first < 4) return null;
  const w = group.end - group.start + 1,
    h = last - first + 1,
    border = 6;
  const base = new OffscreenCanvas(w + 2 * border, h + 2 * border);
  const ctx = base.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, base.width, base.height);
  const data = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const color = mask[(first + y) * width + group.start + x] ? 0 : 255;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = color;
      data.data[i + 3] = 255;
    }
  ctx.putImageData(data, border, border);
  const scale = 3,
    picture = new OffscreenCanvas(base.width * scale, base.height * scale);
  picture.getContext("2d").drawImage(base, 0, 0, picture.width, picture.height);
  return { picture, scale, left: group.start - border, top: top + first - border };
}
