import assert from "node:assert/strict";
import test from "node:test";
import { storagePolicySchema } from "../lib/storage-policy";

test("storage policy bounds quota and treats zero retention as keep indefinitely", () => {
  assert.equal(
    storagePolicySchema.safeParse({
      quotaBytes: 5 * 1024 ** 3,
      retentionDays: 0,
    }).success,
    true,
  );
  assert.equal(
    storagePolicySchema.safeParse({
      quotaBytes: 1024,
      retentionDays: 0,
    }).success,
    false,
  );
  assert.equal(
    storagePolicySchema.safeParse({
      quotaBytes: 1024 ** 4 + 1,
      retentionDays: 0,
    }).success,
    false,
  );
  assert.equal(
    storagePolicySchema.safeParse({
      quotaBytes: 1024 ** 3,
      retentionDays: 3651,
    }).success,
    false,
  );
});
