import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";

async function main() {
  const cloud = new Map<string, Buffer>();
  const server = http.createServer(async (req, res) => {
    const key = new URL(req.url!, "http://localhost").pathname;
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      cloud.set(key, Buffer.concat(chunks));
      res.setHeader("ETag", '"test-object"');
      res.end();
    } else if (req.method === "GET") {
      const bytes = cloud.get(key);
      if (!bytes) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Length", bytes.length);
      res.end(bytes);
    } else if (req.method === "DELETE") {
      cloud.delete(key);
      res.statusCode = 204;
      res.end();
    } else {
      res.statusCode = 405;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    FORMSYNC_S3_ENDPOINT: `http://127.0.0.1:${port}`,
    FORMSYNC_S3_BUCKET: "test-bucket",
    FORMSYNC_S3_REGION: "us-east-1",
    FORMSYNC_S3_PATH_STYLE: "true",
    AWS_ACCESS_KEY_ID: "test-access",
    AWS_SECRET_ACCESS_KEY: "test-secret",
  });
  try {
    const { database, writeDocument } = await import("../lib/database");
    const {
      beginUpload,
      appendChunk,
      uploadFile,
      completeUpload,
      cancelUpload,
      uploadRecord,
      enqueue,
    } = await import("../lib/upload-service");
    const { storageUsage, defaultPolicy } =
      await import("../lib/storage-policy");
    const { runMediaProcess } = await import("../lib/media-service");
    const { workerTick } = await import("../lib/processing-worker");
    const { ensureObject, objectFile, removeObjects } =
      await import("../lib/object-store");
    const { saveSession, getSession, listSessions, deleteSessionRecord } =
      await import("../lib/storage");
    const { createSnapshot } = await import("../lib/snapshots");
    const { restoreSnapshot } = await import("../scripts/snapshot.mjs");
    const root = process.env.FORMSYNC_DATA_DIR!;
    writeDocument("settings", "storage", { ...defaultPolicy, backupHours: 0 });
    const source = path.join(root, "fixture.mp4");
    await runMediaProcess([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x240:rate=12",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-f",
      "mp4",
      "-y",
      source,
    ]);
    const bytes = await fs.readFile(source),
      half = Math.floor(bytes.length / 2);
    const upload = await beginUpload("durable.mp4", "video/mp4", bytes.length);
    assert.equal(storageUsage().reservedBytes, bytes.length);
    await appendChunk(upload.id, 0, bytes.subarray(0, half));
    await assert.rejects(
      appendChunk(upload.id, 0, bytes.subarray(half)),
      /offset changed/,
    );
    await assert.rejects(completeUpload(upload.id), /incomplete/);
    // Simulate a server crash between disk flush and DB offset update.
    await fs.appendFile(uploadFile(upload.id), Buffer.from("uncommitted tail"));
    await appendChunk(upload.id, half, bytes.subarray(half));
    assert.deepEqual(await fs.readFile(uploadFile(upload.id)), bytes);
    await completeUpload(upload.id);
    await completeUpload(upload.id);
    assert.equal(
      database()
        .prepare("SELECT count(*) AS n FROM jobs WHERE kind='ingest'")
        .get()!.n,
      1,
    );
    database()
      .prepare(
        "INSERT INTO jobs(id,kind,media_id,created_at) VALUES(?,'optimize',?,?)",
      )
      .run(crypto.randomUUID(), crypto.randomUUID(), "2000-01-01T00:00:00Z");
    await workerTick();
    assert.equal(uploadRecord(upload.id)!.state, "ready");
    assert.equal(storageUsage().reservedBytes, 0);
    await workerTick();
    await workerTick();
    assert.equal(
      database()
        .prepare(
          "SELECT count(*) AS n FROM objects WHERE media_id=? AND remote=1",
        )
        .get(upload.id)!.n,
      3,
    );
    assert.deepEqual(cloud.get(`/test-bucket/videos/${upload.id}`), bytes);
    await fs.unlink(objectFile(`videos/${upload.id}`));
    assert.deepEqual(
      await fs.readFile(await ensureObject(`videos/${upload.id}`)),
      bytes,
    );
    const session = {
      id: crypto.randomUUID(),
      name: "Cloud recovery check",
      date: "2026-10-04",
      makes: 2,
      misses: 1,
      reps: 3,
      target: 5,
      notes: "durable",
      tags: ["Shooting"],
      fps: 12,
      drawings: [],
      videoId: upload.id,
      videoName: upload.name,
      videoType: upload.type,
      createdAt: new Date().toISOString(),
    };
    await saveSession(session);
    assert.equal((await getSession(session.id))?.notes, "durable");
    assert.equal((await listSessions()).length, 1);
    const cancelled = await beginUpload("cancelled.mp4", "video/mp4", 4);
    await appendChunk(cancelled.id, 0, Buffer.from([1, 2]));
    await cancelUpload(cancelled.id);
    assert.equal(uploadRecord(cancelled.id)!.state, "cancelled");
    assert.equal(storageUsage().reservedBytes, 0);
    writeDocument("settings", "storage", {
      ...defaultPolicy,
      backupHours: 0,
      quotaBytes: storageUsage().usedBytes + 1,
    });
    await assert.rejects(
      beginUpload("quota.mp4", "video/mp4", 10),
      /quota exceeded/,
    );
    writeDocument("settings", "storage", { ...defaultPolicy, backupHours: 0 });
    const snapshot = await createSnapshot();
    assert.equal(snapshot.remote, true);
    const folder = path.join(root, "backups", snapshot.id),
      restored = path.join(root, "restored");
    assert.ok(cloud.has(`/test-bucket/backups/${snapshot.id}/manifest.json`));
    const {promisify}=await import("node:util"),{execFile}=await import("node:child_process");
    const cloudRestored=path.join(root,"cloud-restored");
    await promisify(execFile)(process.execPath,["scripts/restore-cloud.mjs",snapshot.id],{env:{...process.env,FORMSYNC_DATA_DIR:cloudRestored}});
    assert.deepEqual(await fs.readFile(path.join(cloudRestored,"videos",upload.id)),bytes);
    await restoreSnapshot(folder, restored);
    assert.deepEqual(
      await fs.readFile(path.join(restored, "videos", upload.id)),
      bytes,
    );
    const restoredDb = new DatabaseSync(path.join(restored, "formsync.sqlite"));
    assert.equal(
      JSON.parse(
        String(
          restoredDb
            .prepare(
              "SELECT body FROM documents WHERE collection='sessions' AND id=?",
            )
            .get(session.id)!.body,
        ),
      ).notes,
      "durable",
    );
    assert.equal(
      restoredDb
        .prepare("SELECT count(*) AS n FROM objects WHERE remote=1")
        .get()!.n,
      0,
    );
    restoredDb.close();
    await assert.rejects(
      restoreSnapshot(folder, restored),
      /empty data directory/,
    );
    await fs.writeFile(path.join(folder, "videos", upload.id), "corrupt");
    await assert.rejects(
      restoreSnapshot(folder, path.join(root, "corrupt-restore")),
      /checksum failed/,
    );
    database().prepare("UPDATE objects SET created_at=? WHERE key=?").run("2000-01-01T00:00:00Z","videos/"+upload.id);
    writeDocument("settings","storage",{...defaultPolicy,retentionDays:1,backupHours:0});
    enqueue("expire",upload.id);await workerTick();
    assert.equal((await getSession(session.id))?.notes,"durable");
    assert.equal(database().prepare("SELECT count(*) AS n FROM objects WHERE media_id=?").get(upload.id)!.n,0);
    assert.equal(cloud.has(`/test-bucket/videos/${upload.id}`),false);
    await deleteSessionRecord(session.id);
    assert.equal(await getSession(session.id), null);
    await removeObjects(upload.id);
    assert.equal(cloud.has(`/test-bucket/videos/${upload.id}`), false);
    database().close();
    console.log(
      "Phase 3 integration checks passed: offsets, cancellation, quota, FFmpeg, S3 roundtrip, database records, backups and recovery",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
