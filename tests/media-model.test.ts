import test from "node:test";
import assert from "node:assert/strict";
import { frameTiming, nearestFrame, screenToVideo } from "../lib/media-model";
import { sessionInput } from "../lib/validation";
test("frame timing preserves variable timestamps and normalizes offsets", () => {
  const timing = frameTiming([5, 5.033333, 5.066666, 5.133333], 0);
  assert.ok(Math.abs(timing.frames[1] - 0.033333) < 1e-8);
  assert.equal(timing.fps, 30);
  assert.equal(timing.variableFrameRate, true);
  assert.equal(nearestFrame(timing.frames, 0.12), 3);
});
test("fractional frame rates remain fractional", () => {
  const timing = frameTiming([0, 1001 / 30000, 2002 / 30000], 30000 / 1001);
  assert.equal(timing.fps, 29.97);
  assert.equal(timing.variableFrameRate, false);
  assert.equal(nearestFrame(timing.frames, -1), 0);
  assert.equal(nearestFrame(timing.frames, 999), 2);
});
test("single-frame metadata has a finite fallback duration", () => {
  const timing = frameTiming([4], 0);
  assert.equal(timing.fps, 30);
  assert.equal(timing.step, 1 / 30);
});
test("drawing coordinates invert rotation, zoom and pan", () => {
  const point = screenToVideo(138, 177, 360, 640, 640, 360, 90, 2, {
    x: 30,
    y: -15,
  });
  assert.ok(Math.abs(point.x - 0.4) < 1e-10);
  assert.ok(Math.abs(point.y - 0.6) < 1e-10);
});
test("fullscreen fitted planes use their actual dimensions", () => {
  const point = screenToVideo(
    500,
    320,
    1000,
    640,
    640,
    360,
    0,
    1,
    { x: 0, y: 0 },
    { width: 640, height: 360 },
  );
  assert.equal(point.x, 0.5);
  assert.equal(point.y, 0.5);
});
test("editor input supports fractional FPS and rejects invalid rotations and trim times", () => {
  const base = {
    name: "Drill",
    date: "2026-10-04",
    makes: 0,
    misses: 0,
    reps: 0,
    target: 1,
    notes: "",
    tags: [],
    drawings: [],
    fps: 29.97,
    rotation: 90,
    trimStart: 0.1,
    trimEnd: 0.9,
  };
  assert.ok(sessionInput.safeParse(base).success);
  assert.equal(
    sessionInput.safeParse({ ...base, rotation: 45 }).success,
    false,
  );
  assert.equal(
    sessionInput.safeParse({ ...base, trimStart: -1 }).success,
    false,
  );
});

test("frame-indexed trimming preserves annotations on the same decoded frame", async () => {
  const { trimFrameRange, remapTrimmedDrawings } =
    await import("../lib/media-model");
  const frames = [0, 0.033, 0.066, 0.11, 0.15];
  assert.deepEqual(trimFrameRange(frames, 0.04, 0.14), {
    startIndex: 2,
    endIndex: 4,
  });
  const drawing = {
    id: "a",
    tool: "line" as const,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    color: "#b7f76b",
    time: 0.11,
  };
  const result = remapTrimmedDrawings(
    [drawing, { ...drawing, id: "outside", time: 0.02 }],
    frames,
    [0, 0.044],
    0.04,
    0.14,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].time, 0.044);
  assert.equal(trimFrameRange(frames, 0.07, 0.08), null);
});

test("saved rotation remaps annotations and preserves angle geometry", async () => {
  const { rotateDrawings } = await import("../lib/media-model");
  const { jointAngle } = await import("../lib/model");
  const d = {
    id: "joint",
    tool: "angle" as const,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.6 },
      { x: 0.7, y: 0.6 },
    ],
    color: "#b7f76b",
    time: 0.3,
  };
  const result = rotateDrawings([d], 90, 640, 360, 360, 640)[0];
  assert.deepEqual(result.points[0], { x: 0.8, y: 0.2 });
  assert.ok(Math.abs(jointAngle(result.points, 360, 640)! - 90) < 1e-8);
});
