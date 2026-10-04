import { database, readDocument } from "./database";
import { z } from "zod";
import { assertOwnerStorageCapacity } from "./plan-limits";
export type StoragePolicy = {
  quotaBytes: number;
  retentionDays: number;
  backupHours: number;
  backupKeep: number;
};
export const defaultPolicy: StoragePolicy = {
  quotaBytes: 5 * 1024 ** 3,
  retentionDays: 0,
  backupHours: 24,
  backupKeep: 7,
};
export const storagePolicySchema = z.object({
  quotaBytes: z
    .number()
    .int()
    .min(100 * 1024 ** 2)
    .max(1024 ** 4),
  retentionDays: z.number().int().min(0).max(3650),
});
export function storagePolicy(): StoragePolicy {
  const stored = readDocument<Partial<StoragePolicy>>("settings", "storage");
  return {
    ...defaultPolicy,
    ...stored,
  };
}
export function storageUsage() {
  const db = database();
  const used = Number(
    db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM objects").get()!.n,
  );
  const reserved = Number(
    db
      .prepare(
        "SELECT coalesce(sum(size),0) AS n FROM uploads WHERE state IN ('uploading','queued','processing') AND id NOT IN (SELECT media_id FROM objects WHERE key LIKE 'videos/%')",
      )
      .get()!.n,
  );
  const policy = storagePolicy();
  return {
    usedBytes: used,
    reservedBytes: reserved,
    quotaBytes: policy.quotaBytes,
    retentionDays: policy.retentionDays,
  };
}
export function assertCapacity(extraBytes: number, ownerId = "local") {
  const { usedBytes, reservedBytes, quotaBytes } = storageUsage();
  if (usedBytes + reservedBytes + extraBytes > quotaBytes)
    throw Object.assign(
      new Error(
        "Storage quota exceeded. Delete videos or increase your quota.",
      ),
      { status: 413 },
    );
  if (ownerId !== "local")
    assertOwnerStorageCapacity(extraBytes, ownerId, quotaBytes);
}
