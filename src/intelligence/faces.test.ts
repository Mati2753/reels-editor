import { expect, it } from "vitest";
// JavaScript is shared verbatim with the browser bundle.
// @ts-expect-error Web renderer modules are outside the TypeScript compilation unit.
import { framingPoints } from "../../web/faces";
const point = (at: number, x: number) => ({ at, x, y: 0.5 });
it("retains a supported face track only within the current scene", () => {
  const centers = [point(0, 0.2), point(0.5, 0.25), point(1, 0.3), point(1.5, 0.35), point(3, 0.45)];
  expect(framingPoints({ centers, rate: 2 }, 0, 2)).toEqual(centers.slice(0, 4));
  expect(framingPoints({ centers, rate: 2 }, 1.8, 3.2)).toEqual([]);
  expect(framingPoints({ centers: [point(0, 0.2), point(0.5, 0.8)], rate: 2 }, 0, 1)).toEqual([]);
});
