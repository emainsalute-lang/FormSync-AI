import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
test(
  "durable uploads, real video processing and S3-compatible backup recovery",
  { timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.resolve(".tools/storage-test-"));
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/storage-integration-check.ts",
        ],
        { env: { ...process.env, FORMSYNC_DATA_DIR: root }, timeout: 110000 },
      );
      assert.match(result.stdout, /Phase 3 integration checks passed/);
    } finally {
      if (root.startsWith(path.resolve(".tools") + path.sep))
        await fs.rm(root, { recursive: true, force: true });
    }
  },
);
