import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { directTimeline } from "./edl-tools";
const timeline = JSON.parse(readFileSync(new URL("../../examples/demo/edl.json", import.meta.url), "utf8"));
it("edits the native camera and validates adjacency without altering its source", () => {
  const s = timeline.segments[0];
  const result = directTimeline({
    timeline,
    operations: [{ op: "animate-camera", scene: s.id, framing: { scale: 1.12, origin: { x: 0.4, y: 0.5 } } }],
  });
  expect(result.segments[0]).toMatchObject({ framing: { scale: 1.12 } });
  expect(s.framing.scale).toBe(1);
  expect(() =>
    directTimeline({
      timeline,
      operations: [
        { op: "set-transition", transition: { type: "fade", between: ["missing", "missing2"], duration: 0.2 } },
      ],
    }),
  ).toThrow(/adjacent/);
});
