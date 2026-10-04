import test from "node:test";
import assert from "node:assert/strict";
import { jointAngle, successRate } from "../lib/model";
import {
  sessionInput,
  validVideoHeader,
  sameRequestOrigin,
} from "../lib/validation";
test("angle respects video aspect ratio", () => {
  assert.equal(
    jointAngle(
      [
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
      1920,
      1080,
    ),
    90,
  );
  const measured = jointAngle(
    [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    1920,
    1080,
  )!;
  assert.ok(Math.abs(measured - 29.3577535428) < 0.00001);
  assert.equal(
    jointAngle([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]),
    null,
  );
});
test("success rates handle no attempts", () => {
  assert.equal(successRate(0, 0), null);
  assert.equal(successRate(7, 3), 70);
  assert.equal(successRate(0, 3), 0);
});
const draft = {
  name: "Jump shot",
  date: "2026-10-03",
  makes: 7,
  misses: 3,
  reps: 10,
  target: 50,
  notes: "",
  tags: ["Shooting"],
  fps: 30,
  drawings: [],
};
test("validation rejects invalid dates and performance metrics", () => {
  assert.ok(sessionInput.safeParse(draft).success);
  assert.equal(
    sessionInput.safeParse({ ...draft, date: "2026-02-30" }).success,
    false,
  );
  assert.equal(sessionInput.safeParse({ ...draft, reps: -1 }).success, false);
  assert.equal(sessionInput.safeParse({ ...draft, makes: 2.5 }).success, false);
  assert.equal(
    sessionInput.safeParse({ ...draft, videoId: "../../outside" }).success,
    false,
  );
});
test("validation rejects malformed angle drawings", () => {
  const angle = {
    id: "angle",
    tool: "angle",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    color: "#b7f76b",
    time: 0,
  };
  assert.equal(
    sessionInput.safeParse({ ...draft, drawings: [angle] }).success,
    false,
  );
});
test("upload header validation rejects disguised text", () => {
  assert.equal(
    validVideoHeader(new TextEncoder().encode("not a video"), "video/mp4"),
    false,
  );
  assert.equal(
    validVideoHeader(
      new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]),
      "video/mp4",
    ),
    true,
  );
  assert.equal(
    validVideoHeader(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm"),
    true,
  );
});

test("origin check uses the browser-facing Host instead of the internal Next URL", () => {
  assert.equal(
    sameRequestOrigin("http://127.0.0.1:3001", "127.0.0.1:3001"),
    true,
  );
  assert.equal(
    sameRequestOrigin("http://localhost:3000", "localhost:3000"),
    true,
  );
  assert.equal(
    sameRequestOrigin("https://outside.example", "127.0.0.1:3001"),
    false,
  );
  assert.equal(sameRequestOrigin("null", "localhost:3000"), false);
  assert.equal(sameRequestOrigin(null, "localhost:3000"), true);
});
