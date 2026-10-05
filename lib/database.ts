import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dataDirectory, assertPersistentStorage } from "./data-directory";

export const databaseDirectory = dataDirectory;
let connection: DatabaseSync | undefined;
export function database() {
  if (connection) return connection;
  assertPersistentStorage();
  mkdirSync(databaseDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(databaseDirectory, "formsync.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=15000;
    CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(collection,id));
    CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, offset INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'uploading', created_at TEXT NOT NULL, error TEXT, owner_id TEXT NOT NULL DEFAULT 'local');
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, media_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,available_at);
    CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, media_id TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, remote INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS media_owners (media_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shared_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT);
    CREATE INDEX IF NOT EXISTS shared_links_session ON shared_links(session_id,owner_id);
    CREATE TABLE IF NOT EXISTS calendar_feeds (owner_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT);
    CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operational_events (id TEXT PRIMARY KEY, category TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, context TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS operational_events_created ON operational_events(created_at);
    CREATE TABLE IF NOT EXISTS product_analytics (day TEXT NOT NULL, event TEXT NOT NULL, owner_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,event,owner_id));
    CREATE TABLE IF NOT EXISTS subscriptions (owner_id TEXT PRIMARY KEY, stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT, plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'inactive', current_period_end TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stripe_events (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_reminders (owner_id TEXT PRIMARY KEY, hour INTEGER NOT NULL, minute INTEGER NOT NULL, timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_sent_date TEXT);
  `);
  const uploadColumns = db.prepare("PRAGMA table_info(uploads)").all() as {
    name: string;
  }[];
  if (!uploadColumns.some((column) => column.name === "owner_id"))
    db.exec(
      "ALTER TABLE uploads ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'",
    );
  connection = db;
  return db;
}
export function transaction<T>(operation: () => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function readDocument<T>(collection: string, id: string): T | null {
  const row = database()
    .prepare("SELECT body FROM documents WHERE collection=? AND id=?")
    .get(collection, id);
  return row ? (JSON.parse(String(row.body)) as T) : null;
}
export function writeDocument(collection: string, id: string, value: unknown) {
  database()
    .prepare(
      "INSERT INTO documents VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body",
    )
    .run(collection, id, JSON.stringify(value));
}
export function allDocuments<T>(collection: string): T[] {
  return database()
    .prepare("SELECT body FROM documents WHERE collection=?")
    .all(collection)
    .map((row) => JSON.parse(String(row.body)) as T);
}
