import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  database,
  readDocument,
  writeDocument,
  allDocuments,
  transaction,
} from "./database";
import type { Session } from "./model";
import { isOwnerVisible } from "./owner-scope";
import { randomUUID } from "node:crypto";
import { dataDirectory, assertPersistentStorage } from "./data-directory";
import { cloudStorageEnabled } from "./cloud-config";
import { cloudSessions, cloudSession } from "./cloud-store";
export const DATA_DIR = dataDirectory;
export const videoPath = (id: string) => path.join(DATA_DIR, "videos", id);
export function setMediaOwner(id: string, ownerId: string) {
  database()
    .prepare(
      "INSERT INTO media_owners(media_id,owner_id) VALUES(?,?) ON CONFLICT(media_id) DO UPDATE SET owner_id=excluded.owner_id",
    )
    .run(id, ownerId);
}
export function getMediaOwner(id: string): string | undefined {
  const row = database()
    .prepare("SELECT owner_id FROM media_owners WHERE media_id=?")
    .get(id) as { owner_id: string } | undefined;
  return row?.owner_id;
}
export async function initStore() {
  assertPersistentStorage();
  await Promise.all([
    fs.mkdir(path.join(DATA_DIR, "sessions"), { recursive: true }),
    fs.mkdir(path.join(DATA_DIR, "videos"), { recursive: true }),
  ]);
}
let migration: Promise<void> | undefined;
export function migrateRecords() {
  return (migration ||= (async () => {
    await initStore();
    if (readDocument("system", "json-migrated")) return;
    const names = await fs.readdir(path.join(DATA_DIR, "sessions"));
    const records = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(
          async (n) =>
            JSON.parse(
              await fs.readFile(path.join(DATA_DIR, "sessions", n), "utf8"),
            ) as Session,
        ),
    );
    let workspace: unknown;
    try {
      workspace = JSON.parse(
        await fs.readFile(path.join(DATA_DIR, "workspace.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    transaction(() => {
      if (readDocument("system", "json-migrated")) return;
      for (const record of records)
        writeDocument("sessions", record.id, record);
      if (workspace) writeDocument("workspace", "main", workspace);
      writeDocument("system", "json-migrated", {
        at: new Date().toISOString(),
      });
    });
  })().catch((error) => {
    migration = undefined;
    throw error;
  }));
}
export async function listSessions(
  ownerId?: string,
  allowedOwnerIds?: string[],
): Promise<Session[]> {
  if (cloudStorageEnabled()) return cloudSessions(ownerId, allowedOwnerIds);
  await migrateRecords();
  await migrateVideoIndex();
  const sessions = allDocuments<Session>("sessions");
  const visible =
    ownerId === undefined
      ? sessions
      : sessions.filter((session) =>
          isOwnerVisible(session.ownerId, ownerId, allowedOwnerIds || []),
        );
  return visible.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}
let mediaMigration: Promise<void> | undefined;
async function migrateVideoIndex() {
  return (mediaMigration ||= (async () => {
    if (readDocument("system", "media-index-migrated")) return;
    const records = allDocuments<Session>("sessions");
    const entries: {
      id: string;
      bytes: number;
      at: string;
      info: unknown;
      ownerId: string;
    }[] = [];
    for (const record of records) {
      if (readDocument("system", "expired:" + record.videoId)) continue;
      try {
        const stat = await fs.stat(videoPath(record.videoId));
        let info: unknown = null;
        try {
          info = JSON.parse(
            await fs.readFile(
              path.join(DATA_DIR, "metadata", record.videoId + ".json"),
              "utf8",
            ),
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        entries.push({
          id: record.videoId,
          bytes: stat.size,
          at: record.createdAt,
          info,
          ownerId: record.ownerId || "local",
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    transaction(() => {
      if (readDocument("system", "media-index-migrated")) return;
      for (const entry of entries) {
        database()
          .prepare("INSERT OR IGNORE INTO objects VALUES(?,?,?,?,0)")
          .run("videos/" + entry.id, entry.id, entry.bytes, entry.at);
        setMediaOwner(entry.id, entry.ownerId);
        if (entry.info && !readDocument("media", entry.id))
          writeDocument("media", entry.id, entry.info);
        if (
          !database()
            .prepare("SELECT id FROM jobs WHERE kind='optimize' AND media_id=?")
            .get(entry.id)
        )
          database()
            .prepare(
              "INSERT INTO jobs(id,kind,media_id,created_at) VALUES(?,'optimize',?,?)",
            )
            .run(randomUUID(), entry.id, new Date().toISOString());
      }
      writeDocument("system", "media-index-migrated", {
        at: new Date().toISOString(),
      });
    });
  })().catch((e) => {
    mediaMigration = undefined;
    throw e;
  }));
}
export async function getVideoSession(
  id: string,
  ownerId?: string,
  allowedOwnerIds?: string[],
): Promise<Session | undefined> {
  return (await listSessions(ownerId, allowedOwnerIds)).find(
    (s) => s.videoId === id,
  );
}
export async function saveSession(session: Session) {
  await migrateRecords();
  writeDocument("sessions", session.id, session);
}
export async function getSession(
  id: string,
  ownerId?: string,
  allowedOwnerIds?: string[],
): Promise<Session | null> {
  if (cloudStorageEnabled()) return cloudSession(id, ownerId, allowedOwnerIds);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await migrateRecords();
  const session = readDocument<Session>("sessions", id);
  if (!session || ownerId === undefined) return session;
  return isOwnerVisible(session.ownerId, ownerId, allowedOwnerIds || [])
    ? session
    : null;
}
export async function deleteSessionRecord(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid session ID");
  await migrateRecords();
  database()
    .prepare("DELETE FROM documents WHERE collection='sessions' AND id=?")
    .run(id);
}
export async function withStoreLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  // Cloud writes enforce revisions atomically in PostgreSQL, not with disk locks.
  if (cloudStorageEnabled()) return operation();
  await initStore();
  const lock = path.join(DATA_DIR, ".session-lock");
  let acquired = false;
  const deadline = Date.now() + 15000;
  while (!acquired) {
    try {
      await fs.writeFile(lock, String(process.pid), { flag: "wx" });
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = Number(await fs.readFile(lock, "utf8"));
        if (owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (check) {
            if ((check as NodeJS.ErrnoException).code === "ESRCH") {
              await fs.unlink(lock).catch(() => {});
              continue;
            }
          }
        }
      } catch {}
      if (Date.now() > deadline) throw new Error("Session store is busy");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await operation();
  } finally {
    await fs.unlink(lock);
  }
}
