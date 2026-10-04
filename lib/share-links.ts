import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { database } from "./database";
import { getSession } from "./storage";
import type { Session } from "./model";

export type SharedSession = Pick<
  Session,
  | "id"
  | "name"
  | "date"
  | "makes"
  | "misses"
  | "reps"
  | "target"
  | "fps"
  | "videoId"
  | "videoType"
>;
export type ShareLink = {
  id: string;
  session_id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function createShareLink(
  sessionId: string,
  ownerId: string,
  expiresInDays: number | null,
) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt =
    expiresInDays === null
      ? null
      : new Date(
          createdAt.getTime() + expiresInDays * 24 * 60 * 60 * 1000,
        ).toISOString();
  const id = randomUUID();
  database()
    .prepare(
      "INSERT INTO shared_links(id,token_hash,session_id,owner_id,created_at,expires_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      tokenHash(token),
      sessionId,
      ownerId,
      createdAt.toISOString(),
      expiresAt,
    );
  return {
    id,
    token,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt,
  };
}
export function listShareLinks(
  sessionId: string,
  ownerId: string,
): ShareLink[] {
  return database()
    .prepare(
      "SELECT id,session_id,created_at,expires_at,revoked_at FROM shared_links WHERE session_id=? AND owner_id=? ORDER BY created_at DESC",
    )
    .all(sessionId, ownerId) as ShareLink[];
}
export function revokeShareLink(id: string, ownerId: string) {
  return (
    database()
      .prepare(
        "UPDATE shared_links SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL",
      )
      .run(new Date().toISOString(), id, ownerId).changes > 0
  );
}
export async function resolveShareToken(
  token: string,
): Promise<{ session: SharedSession; link: ShareLink } | null> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const now = new Date().toISOString();
  const link = database()
    .prepare(
      "SELECT id,session_id,created_at,expires_at,revoked_at FROM shared_links WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
    )
    .get(tokenHash(token), now) as ShareLink | undefined;
  if (!link) return null;
  const session = await getSession(link.session_id);
  if (!session) return null;
  return {
    link,
    session: {
      id: session.id,
      name: session.name,
      date: session.date,
      makes: session.makes,
      misses: session.misses,
      reps: session.reps,
      target: session.target,
      fps: session.fps,
      videoId: session.videoId,
      videoType: session.videoType,
    },
  };
}
