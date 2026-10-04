import "server-only";
import { database } from "./database";

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  if (!key || !Number.isSafeInteger(limit) || limit < 1 || windowMs < 1)
    throw new Error("Invalid rate-limit configuration.");
  const bucket = Math.floor(now / windowMs);
  const resetAt = (bucket + 1) * windowMs;
  const db = database();
  db.prepare(
    `INSERT INTO rate_limits(bucket,hits,reset_at) VALUES(?,1,?)
     ON CONFLICT(bucket) DO UPDATE SET hits=rate_limits.hits+1`,
  ).run(`${key}:${bucket}`, resetAt);
  const row = db
    .prepare("SELECT hits,reset_at FROM rate_limits WHERE bucket=?")
    .get(`${key}:${bucket}`) as { hits: number; reset_at: number };
  return {
    allowed: row.hits <= limit,
    remaining: Math.max(0, limit - row.hits),
    resetAt: row.reset_at,
  };
}
