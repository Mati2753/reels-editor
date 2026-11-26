/** Measure interleaved, floating-point decoded channels at their delivery rate. */
export function scanDeliverySamples(samples: Float32Array, channels: number, sampleRate: number) {
  if (
    !Number.isInteger(channels) ||
    channels < 1 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    samples.length % channels !== 0
  )
    throw Error("Invalid interleaved delivery audio.");
  const clipping: { start: number; end: number; samples: number }[] = [];
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const level = Math.abs(samples[i]!);
    if (!Number.isFinite(level)) throw Error("Invalid decoded audio sample.");
    max = Math.max(level, max);
    if (level < 1) continue;
    const start = Math.floor(i / channels) / sampleRate;
    const end = start + 1 / sampleRate;
    const last = clipping.at(-1);
    if (last && start - last.end < 0.05) {
      last.end = end;
      last.samples++;
    } else clipping.push({ start, end, samples: 1 });
  }
  return { samplePeakDbfs: max ? 20 * Math.log10(max) : null, clipping };
}
