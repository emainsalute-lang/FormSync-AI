import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { database } from "./database";
import { readWorkspace } from "./training-store";
import { workoutsToCalendar } from "./calendar-export";

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function createCalendarFeed(ownerId: string) {
  const token = randomBytes(32).toString("base64url");
  database()
    .prepare(
      `INSERT INTO calendar_feeds(owner_id,token_hash,created_at,revoked_at)
       VALUES(?,?,?,NULL) ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,revoked_at=NULL`,
    )
    .run(ownerId, hash(token), new Date().toISOString());
  return token;
}
export function revokeCalendarFeed(ownerId: string) {
  return (
    database()
      .prepare(
        "UPDATE calendar_feeds SET revoked_at=? WHERE owner_id=? AND revoked_at IS NULL",
      )
      .run(new Date().toISOString(), ownerId).changes > 0
  );
}
export async function resolveCalendarFeed(token: string) {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const row = database()
    .prepare(
      "SELECT owner_id FROM calendar_feeds WHERE token_hash=? AND revoked_at IS NULL",
    )
    .get(hash(token)) as { owner_id: string } | undefined;
  if (!row) return null;
  const workspace = await readWorkspace(row.owner_id);
  return workoutsToCalendar(workspace.plans);
}
