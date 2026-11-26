export const FPS = 30;
export const MIN_DURATION = 5;
export const MAX_DURATION = 90;

export function toFrame(seconds: number): number {
  return Math.round(seconds * FPS);
}

/** Rounds to the millisecond, the precision every JSON fact is written with. */
export function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}
