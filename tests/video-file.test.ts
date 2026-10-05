import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVideoFile } from "../lib/video-file";

test("normalizes Windows files with missing or generic MIME types", () => {
  for (const type of ["", "application/octet-stream"]) {
    const file = new File(["video"], "practice.MP4", { type });
    const normalized = normalizeVideoFile(file);
    assert.ok(normalized);
    assert.equal(normalized.type, "video/mp4");
    assert.equal(normalized.name, file.name);
    assert.equal(normalized.size, file.size);
  }
});

test("normalizes M4V and preserves supported browser video types", () => {
  const m4v = normalizeVideoFile(
    new File(["video"], "practice.m4v", { type: "video/x-m4v" }),
  );
  assert.equal(m4v?.type, "video/mp4");

  const webm = new File(["video"], "practice.webm", { type: "video/webm" });
  assert.equal(normalizeVideoFile(webm), webm);
});

test("rejects unsupported or conflicting file types", () => {
  assert.equal(
    normalizeVideoFile(new File(["video"], "practice.avi", { type: "" })),
    null,
  );
  assert.equal(
    normalizeVideoFile(
      new File(["video"], "practice.mp4", { type: "video/webm" }),
    ),
    null,
  );
});
