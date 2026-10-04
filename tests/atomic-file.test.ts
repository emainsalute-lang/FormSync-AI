import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../lib/atomic-file";
test("atomic records survive temporary rename locks without losing old data", async () => {
  const root = await fs.mkdtemp(path.resolve(".tools/atomic-test-"));
  const file = path.join(root, "record.json");
  try {
    await fs.writeFile(file, '{"value":"old"}');
    let attempts = 0;
    await atomicWriteJson(file, { value: "new" }, async (a, b) => {
      if (attempts++ < 2) {
        assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
          value: "old",
        });
        throw Object.assign(new Error("Transient lock"), { code: "EPERM" });
      }
      await fs.rename(a, b);
    });
    assert.equal(attempts, 3);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      value: "new",
    });
    assert.deepEqual(await fs.readdir(root), ["record.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("failed atomic writes leave old data intact and remove temporary files", async () => {
  const root = await fs.mkdtemp(path.resolve(".tools/atomic-test-"));
  const file = path.join(root, "record.json");
  try {
    await fs.writeFile(file, '{"value":"old"}');
    await assert.rejects(
      atomicWriteJson(file, { value: "new" }, async () => {
        throw Object.assign(new Error("Disk error"), { code: "EIO" });
      }),
      /Disk error/,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      value: "old",
    });
    assert.deepEqual(await fs.readdir(root), ["record.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
