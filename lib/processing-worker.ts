import { promises as fs } from "node:fs";
import path from "node:path";
import { database, transaction, readDocument, writeDocument } from "./database";
import { enqueue, uploadRecord, uploadFile } from "./upload-service";
import {
  probeMedia,
  runMediaProcess,
  getMediaInfo,
  removeMedia,
} from "./media-service";
import {
  videoPath,
  DATA_DIR,
  listSessions,
  getVideoSession,
  withStoreLock,
} from "./storage";
import { withMediaLock } from "./media-lock";
import { objectFile, storeObject, cloudEnabled } from "./object-store";
import { getMediaOwner, setMediaOwner } from "./storage";
import { assertCapacity, storagePolicy } from "./storage-policy";
import { validVideoHeader } from "./validation";
import { createSnapshot } from "./snapshots";
import { recordOperationalEvent } from "./operations";
import { sendDueReminders } from "./push-reminders";
type Job = { id: string; kind: string; media_id: string; attempts: number };
async function optimize(id: string) {
  const info = await getMediaInfo(id);
  if (cloudEnabled()) await storeObject("videos/" + id, id, info.type);
  const thumbnail = objectFile(`thumbnails/${id}.jpg`),
    proxy = objectFile(`optimized/${id}.mp4`);
  await fs.mkdir(path.dirname(thumbnail), { recursive: true });
  await fs.mkdir(path.dirname(proxy), { recursive: true });
  await runMediaProcess([
    "-v",
    "error",
    "-ss",
    String(Math.min(info.duration / 3, 1)),
    "-i",
    videoPath(id),
    "-frames:v",
    "1",
    "-vf",
    "scale=480:-2",
    "-y",
    thumbnail,
  ]);
  await withStoreLock(async () => {
    if (
      !database()
        .prepare("SELECT key FROM objects WHERE key=?")
        .get(`thumbnails/${id}.jpg`)
    )
      assertCapacity((await fs.stat(thumbnail)).size, getMediaOwner(id));
    await storeObject(`thumbnails/${id}.jpg`, id, "image/jpeg");
  });
  await runMediaProcess([
    "-v",
    "error",
    "-i",
    videoPath(id),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale=w='min(1280,iw)':h=-2,pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "25",
    "-pix_fmt",
    "yuv420p",
    "-vsync",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    proxy,
  ]);
  await withStoreLock(async () => {
    if (
      !database()
        .prepare("SELECT key FROM objects WHERE key=?")
        .get(`optimized/${id}.mp4`)
    )
      assertCapacity((await fs.stat(proxy)).size, getMediaOwner(id));
    await storeObject(`optimized/${id}.mp4`, id, "video/mp4");
  });
}
async function optimizeIfPresent(id: string) {
  if (
    database()
      .prepare("SELECT key FROM objects WHERE key=?")
      .get(`optimized/${id}.mp4`)
  )
    return;
  if (
    !database()
      .prepare("SELECT key FROM objects WHERE key=?")
      .get("videos/" + id)
  )
    return;
  await optimize(id);
}
async function ingest(id: string) {
  const upload = uploadRecord(id);
  if (!upload || !["queued", "processing", "ready"].includes(upload.state))
    throw new Error("Upload is unavailable");
  database()
    .prepare("UPDATE uploads SET state='processing',error=NULL WHERE id=?")
    .run(id);
  const bytes = await fs.readFile(uploadFile(id));
  if (bytes.length !== upload.size || !validVideoHeader(bytes, upload.type))
    throw new Error("File contents do not match the video format");
  await fs.mkdir(path.dirname(videoPath(id)), { recursive: true });
  await fs.writeFile(videoPath(id), bytes);
  setMediaOwner(id, upload.owner_id);
  await probeMedia(id, upload.name, upload.type);
  // Ready means the browser-compatible video is available as well as metadata.
  await optimizeIfPresent(id);
  database()
    .prepare("UPDATE uploads SET state='ready',error=NULL WHERE id=?")
    .run(id);
  await fs.unlink(uploadFile(id)).catch(() => {});
}
let running = false;
export async function workerTick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now(),
      db = database();
    const job = transaction(() => {
      // Durable lease allows a killed worker to be recovered by another process.
      const row = db
        .prepare(
          "SELECT id,kind,media_id,attempts FROM jobs WHERE (state='queued' AND available_at<=?) OR (state='running' AND lease_until<?) ORDER BY CASE kind WHEN 'ingest' THEN 0 WHEN 'delete' THEN 1 WHEN 'expire' THEN 1 WHEN 'optimize' THEN 2 ELSE 3 END, created_at LIMIT 1",
        )
        .get(now, now) as Job | undefined;
      if (row)
        db.prepare(
          "UPDATE jobs SET state='running',attempts=attempts+1,lease_until=? WHERE id=?",
        ).run(now + 15 * 60 * 1000, row.id);
      return row;
    });
    if (job) {
      const heartbeat = setInterval(() => {
        db.prepare(
          "UPDATE jobs SET lease_until=? WHERE id=? AND state='running'",
        ).run(Date.now() + 15 * 60 * 1000, job.id);
      }, 30000);
      heartbeat.unref();
      try {
        if (job.kind === "ingest") await ingest(job.media_id);
        else if (job.kind === "optimize")
          await withMediaLock(job.media_id, () =>
            optimizeIfPresent(job.media_id),
          );
        else if (job.kind === "backup") await createSnapshot();
        else if (job.kind === "delete")
          await withMediaLock(job.media_id, () =>
            withStoreLock(async () => {
              if (!(await getVideoSession(job.media_id)))
                await removeMedia(job.media_id);
            }),
          );
        else if (job.kind === "expire")
          await withMediaLock(job.media_id, () =>
            withStoreLock(async () => {
              const policy = storagePolicy(),
                row = db
                  .prepare("SELECT created_at FROM objects WHERE key=?")
                  .get("videos/" + job.media_id);
              if (
                row &&
                policy.retentionDays > 0 &&
                Date.now() - Date.parse(String(row.created_at)) >
                  policy.retentionDays * 86400000
              ) {
                await removeMedia(job.media_id);
                writeDocument("system", "expired:" + job.media_id, {
                  at: new Date().toISOString(),
                });
              }
            }),
          );
        else throw new Error("Unknown processing job");
        db.prepare(
          "UPDATE jobs SET state='done',error=NULL,lease_until=0 WHERE id=?",
        ).run(job.id);
      } catch (e) {
        const error = e instanceof Error ? e.message : "Processing failed",
          failed = job.attempts >= 2;
        db.prepare(
          "UPDATE jobs SET state=?,error=?,lease_until=0,available_at=? WHERE id=?",
        ).run(
          failed ? "failed" : "queued",
          error,
          Date.now() + 30000 * (job.attempts + 1),
          job.id,
        );
        if (job.kind === "ingest")
          db.prepare("UPDATE uploads SET state=?,error=? WHERE id=?").run(
            failed ? "failed" : "queued",
            error,
            job.media_id,
          );
        console.error("Background processing failed", job.kind, error);
        recordOperationalEvent("background-job", "error", error, {
          kind: job.kind,
          mediaId: job.media_id,
          attempts: job.attempts + 1,
        });
      } finally {
        clearInterval(heartbeat);
      }
    }
    await maintenance();
  } finally {
    running = false;
  }
}
let lastMaintenance = 0;
async function maintenance() {
  if (Date.now() - lastMaintenance < 60000) return;
  lastMaintenance = Date.now();
  await sendDueReminders();
  const policy = storagePolicy(),
    db = database();
  db.prepare("DELETE FROM rate_limits WHERE reset_at<?").run(Date.now());
  const last = readDocument<{ at: number }>("system", "last-backup-scheduled");
  if (
    policy.backupHours &&
    (!last || Date.now() - last.at >= policy.backupHours * 3600000)
  )
    transaction(() => {
      enqueue("backup", "scheduled");
      writeDocument("system", "last-backup-scheduled", { at: Date.now() });
    });
  const sessions = await listSessions(),
    referenced = new Set(sessions.map((s) => s.videoId));
  for (const row of db
    .prepare(
      "SELECT DISTINCT media_id,created_at FROM objects WHERE key LIKE 'videos/%'",
    )
    .all()) {
    const id = String(row.media_id),
      expired =
        policy.retentionDays > 0 &&
        Date.now() - Date.parse(String(row.created_at)) >
          policy.retentionDays * 86400000;
    const abandoned =
      !referenced.has(id) &&
      Date.now() - Date.parse(String(row.created_at)) > 86400000;
    if (expired) enqueue("expire", id);
    else if (abandoned) enqueue("delete", id);
  }
  for (const row of db
    .prepare("SELECT id FROM uploads WHERE state='uploading' AND created_at<?")
    .all(new Date(Date.now() - 7 * 86400000).toISOString())) {
    const id = String(row.id);
    await withStoreLock(async () => {
      const current = uploadRecord(id);
      if (current?.state === "uploading") {
        db.prepare("UPDATE uploads SET state='cancelled' WHERE id=?").run(id);
        await fs.unlink(uploadFile(id)).catch(() => {});
      }
    });
  }
}
export function startWorker() {
  const globalWorker = globalThis as typeof globalThis & {
    formsyncWorker?: ReturnType<typeof setInterval>;
  };
  if (globalWorker.formsyncWorker) return;
  globalWorker.formsyncWorker = setInterval(
    () =>
      void workerTick().catch((e) => console.error("Worker unavailable", e)),
    1000,
  );
  globalWorker.formsyncWorker.unref();
}
