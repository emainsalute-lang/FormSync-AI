import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { database, databaseDirectory, transaction } from "./database";
import { assertCapacity } from "./storage-policy";
import { MAX_VIDEO_BYTES } from "./validation";
import { withStoreLock } from "./storage";
import { UPLOAD_CHUNK_BYTES } from "./upload-constants";
export const CHUNK_BYTES = UPLOAD_CHUNK_BYTES;
export type UploadRecord = {
  id: string;
  name: string;
  type: string;
  size: number;
  offset: number;
  state: string;
  created_at: string;
  error: string | null;
  owner_id: string;
};
export function uploadRecord(id: string) {
  return database().prepare("SELECT * FROM uploads WHERE id=?").get(id) as
    UploadRecord | undefined;
}
export const uploadFile = (id: string) =>
  path.join(databaseDirectory, "uploads", id);
export function enqueue(kind: string, mediaId: string) {
  const db = database();
  if (
    db
      .prepare(
        "SELECT id FROM jobs WHERE kind=? AND media_id=? AND state IN ('queued','running')",
      )
      .get(kind, mediaId)
  )
    return;
  db.prepare(
    "INSERT INTO jobs(id,kind,media_id,created_at) VALUES(?,?,?,?)",
  ).run(randomUUID(), kind, mediaId, new Date().toISOString());
}
export async function beginUpload(
  name: string,
  type: string,
  size: number,
  ownerId = "local",
) {
  if (
    typeof name !== "string" ||
    typeof type !== "string" ||
    !name ||
    name.length > 200 ||
    !["video/mp4", "video/webm", "video/quicktime"].includes(type) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_VIDEO_BYTES
  )
    throw Object.assign(
      new Error("Choose an MP4, WebM or MOV video up to 100 MB."),
      { status: 400 },
    );
  const id = randomUUID();
  await fs.mkdir(path.dirname(uploadFile(id)), { recursive: true });
  transaction(() => {
    assertCapacity(size, ownerId);
    database()
      .prepare(
        "INSERT INTO uploads(id,name,type,size,created_at,owner_id) VALUES(?,?,?,?,?,?)",
      )
      .run(id, name, type, size, new Date().toISOString(), ownerId);
  });
  return uploadRecord(id)!;
}
export async function appendChunk(id: string, offset: number, bytes: Buffer) {
  return withStoreLock(async () => {
    const upload = uploadRecord(id);
    if (!upload)
      throw Object.assign(new Error("Upload not found"), { status: 404 });
    if (upload.state !== "uploading" || offset !== upload.offset)
      throw Object.assign(
        new Error("Upload offset changed. Refresh its status and resume."),
        { status: 409 },
      );
    if (
      !bytes.length ||
      bytes.length > CHUNK_BYTES ||
      offset + bytes.length > upload.size
    )
      throw Object.assign(new Error("Invalid chunk size"), { status: 413 });
    const handle = await fs.open(uploadFile(id), offset === 0 ? "w+" : "r+");
    try {
      // A crash after a disk write but before the DB commit leaves a tail: truncate before retrying.
      await handle.truncate(offset);
      let written = 0;
      while (written < bytes.length) {
        const result = await handle.write(
          bytes,
          written,
          bytes.length - written,
          offset + written,
        );
        if (!result.bytesWritten)
          throw new Error("Upload chunk could not be written completely.");
        written += result.bytesWritten;
      }
      await handle.sync();
      database()
        .prepare("UPDATE uploads SET offset=? WHERE id=?")
        .run(offset + bytes.length, id);
    } finally {
      await handle.close();
    }
    return uploadRecord(id)!;
  });
}
export async function completeUpload(id: string) {
  return withStoreLock(async () => {
    const upload = uploadRecord(id);
    if (!upload)
      throw Object.assign(new Error("Upload not found"), { status: 404 });
    if (["queued", "processing", "ready"].includes(upload.state)) return upload;
    if (upload.state !== "uploading" || upload.offset !== upload.size)
      throw Object.assign(new Error("Upload is incomplete"), { status: 409 });
    transaction(() => {
      database()
        .prepare("UPDATE uploads SET state='queued' WHERE id=?")
        .run(id);
      enqueue("ingest", id);
    });
    return uploadRecord(id)!;
  });
}
export async function cancelUpload(id: string) {
  return withStoreLock(async () => {
    const upload = uploadRecord(id);
    if (!upload)
      throw Object.assign(new Error("Upload not found"), { status: 404 });
    if (upload.state !== "uploading" && upload.state !== "cancelled")
      throw Object.assign(
        new Error(
          "Processing has started. Delete the completed video from Storage.",
        ),
        { status: 409 },
      );
    database()
      .prepare("UPDATE uploads SET state='cancelled' WHERE id=?")
      .run(id);
    await fs.unlink(uploadFile(id)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  });
}
