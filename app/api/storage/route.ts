import { NextResponse } from "next/server";
import { z } from "zod";
import { database, allDocuments, writeDocument } from "@/lib/database";
import { storageUsage, storagePolicy } from "@/lib/storage-policy";
import { cloudEnabled } from "@/lib/object-store";
import { listSessions, withStoreLock } from "@/lib/storage";
import { originAllowed } from "@/lib/session-service";
import { enqueue } from "@/lib/upload-service";
import { validId } from "@/lib/media-service";
import type { MediaInfo } from "@/lib/media-model";
import type { Snapshot } from "@/lib/snapshots";
import { appIdentity, canAccessOwner } from "@/lib/user-scope";
import { getMediaOwner } from "@/lib/storage";
import { ownerUsage } from "@/lib/plan-limits";
import { adminAuthorized } from "@/lib/admin-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const identity = await appIdentity(),
      canManage = identity.role === "local" || adminAuthorized(request);
    const sessions = await listSessions(
        identity.userId,
        identity.accessibleOwnerIds,
      ),
      db = database();
    const visible = (id: string) =>
      canManage || canAccessOwner(identity, getMediaOwner(id));
    return NextResponse.json(
      {
        provider: cloudEnabled() ? "S3-compatible cloud" : "Local storage",
        database: "SQLite",
        canManage,
        canDelete: identity.role !== "coach",
        usage: canManage ? storageUsage() : ownerUsage(identity.userId),
        policy: storagePolicy(),
        videos: allDocuments<MediaInfo>("media")
          .filter((m) => visible(m.id))
          .map((m) => ({
            id: m.id,
            sessionId: sessions.find((s) => s.videoId === m.id)?.id || null,
            name: m.name,
            duration: m.duration,
            sessions: sessions.filter((s) => s.videoId === m.id).length,
            objects: db
              .prepare(
                "SELECT key,bytes,remote,created_at FROM objects WHERE media_id=?",
              )
              .all(m.id),
          })),
        jobs: db
          .prepare(
            "SELECT id,kind,media_id,state,attempts,error,created_at FROM jobs ORDER BY created_at DESC LIMIT 100",
          )
          .all()
          .filter((j) => visible(String(j.media_id)))
          .slice(0, 40),
        uploads: db
          .prepare(
            "SELECT id,name,size,offset,state,error,created_at,owner_id FROM uploads WHERE state IN ('uploading','queued','processing','failed') ORDER BY created_at DESC LIMIT 100",
          )
          .all()
          .filter((u) => canManage || String(u.owner_id) === identity.userId)
          .slice(0, 30),
        backups: canManage
          ? allDocuments<Snapshot>("backups")
              .map(({ files, ...b }) => ({
                ...b,
                fileCount: Object.keys(files).length,
              }))
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Storage read failed", e);
    return NextResponse.json(
      { error: "Storage is unavailable" },
      { status: 503 },
    );
  }
}
// Preserve the original quota/retention endpoint contract while retaining backup settings.
export async function PUT(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    if (Number(request.headers.get("content-length")) > 4096)
      throw new Error("Request too large");
    const input = policyInput
      .pick({ quotaBytes: true, retentionDays: true })
      .parse(await request.json());
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        action: "policy",
        policy: { ...storagePolicy(), ...input },
      }),
    });
    return POST(forwarded);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid storage policy" },
      { status: 400 },
    );
  }
}
const policyInput = z.object({
  quotaBytes: z
    .number()
    .int()
    .min(100 * 1024 ** 2)
    .max(1024 ** 4),
  retentionDays: z.number().int().min(0).max(3650),
  backupHours: z.number().int().min(0).max(168),
  backupKeep: z.number().int().min(1).max(30),
});
export async function POST(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    if (Number(request.headers.get("content-length")) > 4096)
      throw new Error("Request too large");
    const body = await request.json();
    const identity = await appIdentity(),
      canManage = identity.role === "local" || adminAuthorized(request);
    if (identity.role === "coach")
      return NextResponse.json(
        { error: "Coach access is read-only" },
        { status: 403 },
      );
    if (["policy", "backup"].includes(body.action) && !canManage)
      return NextResponse.json(
        {
          error:
            "Only the server administrator can change storage settings or create a full backup",
        },
        { status: 403 },
      );
    await withStoreLock(async () => {
      if (body.action === "policy") {
        const policy = policyInput.parse(body.policy);
        const usage = storageUsage();
        if (policy.quotaBytes < usage.usedBytes + usage.reservedBytes)
          throw new Error("Quota cannot be below stored and reserved bytes");
        writeDocument("settings", "storage", policy);
      } else if (body.action === "backup") enqueue("backup", "manual");
      else if (body.action === "retry") {
        if (!validId(body.id)) throw new Error("Invalid job ID");
        const job = database()
          .prepare("SELECT * FROM jobs WHERE id=? AND state='failed'")
          .get(body.id);
        if (!job) throw new Error("Failed job not found");
        if (
          !canManage &&
          getMediaOwner(String(job.media_id)) !== identity.userId
        )
          throw new Error("Job not found");
        database()
          .prepare(
            "UPDATE jobs SET state='queued',attempts=0,error=NULL,available_at=0 WHERE id=?",
          )
          .run(body.id);
        if (job.kind === "ingest")
          database()
            .prepare("UPDATE uploads SET state='queued',error=NULL WHERE id=?")
            .run(String(job.media_id));
      } else if (body.action === "delete") {
        if (!validId(body.id)) throw new Error("Invalid video ID");
        if (!canManage && getMediaOwner(body.id) !== identity.userId)
          throw new Error("Video not found");
        if ((await listSessions()).some((s) => s.videoId === body.id))
          throw new Error(
            "Delete the linked session first, or use automatic retention to expire its video",
          );
        enqueue("delete", body.id);
      } else throw new Error("Unknown action");
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues[0]?.message
            : e instanceof Error
              ? e.message
              : "Storage update failed",
      },
      { status: 400 },
    );
  }
}
