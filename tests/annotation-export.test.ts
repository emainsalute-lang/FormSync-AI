import { test } from "node:test";
import assert from "node:assert/strict";
import { annotationWindows, annotationSvg } from "../lib/annotation-export";
import type { Drawing } from "../lib/model";
const drawing: Drawing = {
  id: "line",
  tool: "line",
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.5, y: 0.2 },
  ],
  color: "#b7f76b",
  time: 0.08,
};
test("video overlay visibility uses decoded-frame midpoints", () => {
  const [w] = annotationWindows([drawing], [0, 0.04, 0.08, 0.12], 0.16);
  assert.equal(w.start, 0.06);
  assert.equal(w.end, 0.1);
  assert.equal(
    annotationWindows([{ ...drawing, time: 0.2 }], [0, 0.04], 0.08).length,
    0,
  );
});
test("SVG exports scaled markup and aspect-correct angle text", () => {
  const svg = annotationSvg(
    [
      {
        ...drawing,
        tool: "angle",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.1 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ],
    640,
    360,
  );
  assert.match(svg, /90°/);
  assert.match(svg, /64.00,36.00/);
  assert.match(svg, /320.00,180.00/);
});
