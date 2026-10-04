import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { snapshotDatabase } from "../scripts/snapshot.mjs";
import { DATA_DIR, withStoreLock, listSessions } from "./storage";
import { cloudEnabled, ensureObject, s3 } from "./object-store";
import { allDocuments, writeDocument, database } from "./database";
import { storagePolicy } from "./storage-policy";
export type Snapshot = {
  id: string;
  createdAt: string;
  files: Record<string, string>;
  remote: boolean;
};
export async function createSnapshot() {
  await listSessions();
  const id = randomUUID(),
    destination = path.join(DATA_DIR, "backups", id);
  const manifest = await withStoreLock(() =>
    snapshotDatabase(DATA_DIR, destination, ensureObject),
  );
  const files = manifest.files as Record<string, string>;
  if (cloudEnabled()) {
    for (const file of [...Object.keys(files), "manifest.json"]) {
      const target = path.join(destination, file),
        stat = await fs.stat(target);
      await s3().send(
        new PutObjectCommand({
          Bucket:
            process.env.FORMSYNC_S3_BACKUP_BUCKET ||
            process.env.FORMSYNC_S3_BUCKET,
          Key: `backups/${id}/${file}`,
          Body: createReadStream(target),
          ContentLength: stat.size,
        }),
      );
    }
  }
  const result: Snapshot = {
    id,
    createdAt: manifest.createdAt,
    files,
    remote: cloudEnabled(),
  };
  writeDocument("backups", id, result);
  const retained = allDocuments<Snapshot>("backups").sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  for (const old of retained.slice(storagePolicy().backupKeep)) {
    if (old.remote && !cloudEnabled()) continue;
    if (old.remote)
      for (const file of [...Object.keys(old.files), "manifest.json"])
        await s3().send(
          new DeleteObjectCommand({
            Bucket:
              process.env.FORMSYNC_S3_BACKUP_BUCKET ||
              process.env.FORMSYNC_S3_BUCKET,
            Key: `backups/${old.id}/${file}`,
          }),
        );
    const oldDir = path.resolve(DATA_DIR, "backups", old.id);
    if (
      !/^[0-9a-f-]{36}$/.test(old.id) ||
      !oldDir.startsWith(path.resolve(DATA_DIR, "backups") + path.sep)
    )
      throw new Error("Unsafe snapshot path");
    await fs.rm(oldDir, { recursive: true, force: true });
    database()
      .prepare("DELETE FROM documents WHERE collection='backups' AND id=?")
      .run(old.id);
  }
  return result;
}
