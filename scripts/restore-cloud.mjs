import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { safeEntry, restoreSnapshot } from "./snapshot.mjs";
const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(id || ""))
  throw new Error("Supply a snapshot UUID from Storage & recovery");
const bucket =
  process.env.FORMSYNC_S3_BACKUP_BUCKET || process.env.FORMSYNC_S3_BUCKET;
if (!bucket)
  throw new Error("Configure FORMSYNC_S3_BUCKET or FORMSYNC_S3_BACKUP_BUCKET");
const destination = path.resolve(process.env.FORMSYNC_DATA_DIR || "data");
const existing = await fs.readdir(destination).catch((e) => {
  if (e.code === "ENOENT") return [];
  throw e;
});
if (existing.length)
  throw new Error("Restore requires an empty data directory");
const client = new S3Client({
  region: process.env.FORMSYNC_S3_REGION || "auto",
  endpoint: process.env.FORMSYNC_S3_ENDPOINT || undefined,
  forcePathStyle: process.env.FORMSYNC_S3_PATH_STYLE === "true",
});
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "formsync-recovery-"));
async function download(file) {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: `backups/${id}/${file}` }),
  );
  if (!result.Body) throw new Error("Cloud snapshot file missing");
  const target = path.join(temp, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await pipeline(result.Body, createWriteStream(target, { flags: "wx" }));
}
try {
  await download("manifest.json");
  const manifest = JSON.parse(
    await fs.readFile(path.join(temp, "manifest.json"), "utf8"),
  );
  if (manifest.format !== "formsync-backup-v2")
    throw new Error("Unknown backup format");
  for (const file of Object.keys(manifest.files)) {
    if (!safeEntry(file)) throw new Error("Unsafe backup entry");
    await download(file);
  }
  await restoreSnapshot(temp, destination);
  console.log("Cloud snapshot restored to " + destination);
} finally {
  if (
    temp.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
    path.basename(temp).startsWith("formsync-recovery-")
  )
    await fs.rm(temp, { recursive: true, force: true });
}
