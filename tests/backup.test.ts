import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
test("full backup restores video bytes and refuses overwrite or corrupt data", async () => {
  const root = await fs.mkdtemp(path.resolve(".tools/backup-test-"));
  const source = path.join(root, "source"),
    snapshot = path.join(root, "snapshot"),
    restored = path.join(root, "restored"),
    id = "00000000-0000-4000-8000-000000000001",
    videoId = "00000000-0000-4000-8000-000000000002";
  try {
    await fs.mkdir(path.join(source, "sessions"), { recursive: true });
    await fs.mkdir(path.join(source, "videos"), { recursive: true });
    await fs.writeFile(
      path.join(source, "sessions", id + ".json"),
      JSON.stringify({ id, videoId }),
    );
    await fs.writeFile(
      path.join(source, "videos", videoId),
      Buffer.from([1, 2, 3, 4]),
    );
    await fs.writeFile(
      path.join(source, "workspace.json"),
      JSON.stringify({ version: 1 }),
    );
    const script = path.resolve("scripts/backup.mjs");
    await exec(process.execPath, [script, "backup", snapshot], {
      env: { ...process.env, FORMSYNC_DATA_DIR: source },
    });
    await exec(process.execPath, [script, "restore", snapshot], {
      env: { ...process.env, FORMSYNC_DATA_DIR: restored },
    });
    assert.deepEqual(
      await fs.readFile(path.join(restored, "videos", videoId)),
      Buffer.from([1, 2, 3, 4]),
    );
    await assert.rejects(
      exec(process.execPath, [script, "restore", snapshot], {
        env: { ...process.env, FORMSYNC_DATA_DIR: restored },
      }),
      /empty data directory/,
    );
    await fs.writeFile(path.join(snapshot, "videos", videoId), "corrupted");
    await assert.rejects(
      exec(process.execPath, [script, "restore", snapshot], {
        env: { ...process.env, FORMSYNC_DATA_DIR: path.join(root, "another") },
      }),
      /checksum failed/,
    );
  } finally {
    if (root.startsWith(path.resolve(".tools") + path.sep))
      await fs.rm(root, { recursive: true, force: true });
  }
});
