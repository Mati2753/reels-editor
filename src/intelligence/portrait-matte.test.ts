import { it, expect } from "vitest";
import { evaluateMatte } from "./portrait-matte";
it("preserves soft edges and checks known face coverage", () => {
  const values = new Float32Array([0, 1, 0, 0.6]);
  expect(evaluateMatte(values, 2, { x: 0.8, y: 0.2 })).toMatchObject({
    accepted: true,
    foreground: 0.25,
    background: 0.5,
    mask: new Uint8Array([0, 255, 0, 153]),
  });
  expect(evaluateMatte(values, 2, { x: 0, y: 0 }).accepted).toBe(false);
});
it("abstains on uniform, nonfinite or malformed model outputs", () => {
  expect(evaluateMatte(new Float32Array([1, 1, 1, 1]), 2).accepted).toBe(false);
  expect(evaluateMatte(new Float32Array([1, 0, 1, NaN]), 2).accepted).toBe(false);
  expect(() => evaluateMatte(new Float32Array([0]), 2)).toThrow(/dimensions/);
});
