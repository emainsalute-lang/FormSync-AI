import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  resolveDataDirectory,
  assertPersistentStorage,
} from "../lib/data-directory";

test("storage uses the configured persistent mount", () => {
  const cwd = process.cwd();
  assert.equal(resolveDataDirectory({}, cwd), path.join(cwd, "data"));
  assert.equal(
    resolveDataDirectory({ FORMSYNC_DATA_DIR: "mounted-data" }, cwd),
    path.join(cwd, "mounted-data"),
  );
  assert.doesNotThrow(() => assertPersistentStorage({}, cwd));
});

test("ephemeral serverless storage returns an actionable deployment error", () => {
  for (const env of [{ VERCEL: "1" }, { AWS_LAMBDA_FUNCTION_NAME: "formsync" }])
    assert.throws(
      () => assertPersistentStorage(env, "/var/task"),
      /persistent writable disk/,
    );
  assert.throws(
    () => assertPersistentStorage({}, "/var/task"),
    /FORMSYNC_DATA_DIR/,
  );
});
