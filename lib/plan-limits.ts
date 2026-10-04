import { database } from "./database";

export type PlanName = "free" | "pro" | "team";
const limits: Record<
  PlanName,
  { storageBytes: number; sessions: number; analyses: number; workouts: number }
> = {
  free: {
    storageBytes: 2 * 1024 ** 3,
    sessions: 100,
    analyses: 10,
    workouts: 10,
  },
  pro: {
    storageBytes: 50 * 1024 ** 3,
    sessions: 5000,
    analyses: 100,
    workouts: 100,
  },
  team: {
    storageBytes: 250 * 1024 ** 3,
    sessions: 50000,
    analyses: 100,
    workouts: 100,
  },
};
export function ownerPlan(ownerId: string): PlanName {
  if (ownerId === "local") return "team";
  const row = database()
    .prepare("SELECT plan,status FROM subscriptions WHERE owner_id=?")
    .get(ownerId) as { plan: string; status: string } | undefined;
  return row &&
    ["active", "trialing"].includes(row.status) &&
    (row.plan === "pro" || row.plan === "team")
    ? row.plan
    : "free";
}
export function ownerUsage(ownerId: string) {
  const db = database();
  const used = db
    .prepare(
      `SELECT coalesce(sum(o.bytes),0) AS n
     FROM objects o JOIN media_owners m ON m.media_id=o.media_id
     WHERE m.owner_id=?`,
    )
    .get(ownerId) as { n: number };
  const reserved = db
    .prepare(
      "SELECT coalesce(sum(size),0) AS n FROM uploads WHERE owner_id=? AND state IN ('uploading','queued','processing') AND id NOT IN (SELECT media_id FROM objects WHERE key LIKE 'videos/%')",
    )
    .get(ownerId) as { n: number };
  const plan = ownerPlan(ownerId);
  return {
    plan,
    usedBytes: Number(used.n),
    reservedBytes: Number(reserved.n),
    quotaBytes: limits[plan].storageBytes,
    sessionsLimit: limits[plan].sessions,
    analysesLimit: limits[plan].analyses,
    workoutsLimit: limits[plan].workouts,
  };
}
export function assertWorkspacePlanCapacity(
  ownerId: string,
  data: { analyses: unknown[]; workouts: unknown[] },
) {
  if (ownerId === "local") return;
  const usage = ownerUsage(ownerId);
  if (data.analyses.length > usage.analysesLimit)
    throw Object.assign(
      new Error(
        `The ${usage.plan} plan allows up to ${usage.analysesLimit} saved movement analyses.`,
      ),
      { status: 402 },
    );
  if (data.workouts.length > usage.workoutsLimit)
    throw Object.assign(
      new Error(
        `The ${usage.plan} plan allows up to ${usage.workoutsLimit} workout templates.`,
      ),
      { status: 402 },
    );
}
export function assertSessionCapacity(ownerId: string) {
  if (ownerId === "local") return;
  const count = Number(
    database()
      .prepare(
        "SELECT count(*) AS n FROM documents WHERE collection='sessions' AND json_extract(body,'$.ownerId')=?",
      )
      .get(ownerId)!.n,
  );
  const { sessionsLimit, plan } = ownerUsage(ownerId);
  if (count >= sessionsLimit)
    throw Object.assign(
      new Error(
        `The ${plan} plan allows up to ${sessionsLimit} saved sessions.`,
      ),
      { status: 402 },
    );
}
export function assertOwnerStorageCapacity(
  extraBytes: number,
  ownerId: string,
  serverQuotaBytes: number,
) {
  if (ownerId === "local") return;
  const usage = ownerUsage(ownerId);
  const effectiveQuota = Math.min(usage.quotaBytes, serverQuotaBytes);
  if (usage.usedBytes + usage.reservedBytes + extraBytes > effectiveQuota)
    throw Object.assign(
      new Error(
        `Storage limit reached for the ${usage.plan} plan. Upgrade or remove stored media.`,
      ),
      { status: 413 },
    );
}
