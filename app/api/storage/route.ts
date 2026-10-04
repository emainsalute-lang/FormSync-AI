import { NextResponse } from "next/server";
import { database, transaction, writeDocument } from "@/lib/database";
import { listSessions, withStoreLock } from "@/lib/storage";
import {
  storagePolicy,
  storagePolicySchema,
  storageUsage,
} from "@/lib/storage-policy";
import { sameRequestOrigin } from "@/lib/validation";
import { cloudEnabled } from "@/lib/object-store";
import { appIdentity } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await appIdentity();
    const sessions = await listSessions(
      identity.userId,
      identity.accessibleOwnerIds,
    );
    const db = database();
    const ownerIds = identity.accessibleOwnerIds;
    const ownedMedia = ownerIds.length
      ? (db
          .prepare(
            `SELECT media_id FROM media_owners WHERE owner_id IN (${ownerIds.map(() => "?").join(",")})`,
          )
          .all(...ownerIds) as { media_id: string }[])
      : [];
    const mediaIds = new Set([
      ...sessions.map((session) => session.videoId),
      ...ownedMedia.map((media) => media.media_id),
    ]);
    const objects = (
      db
        .prepare("SELECT key,media_id,bytes,created_at,remote FROM objects")
        .all() as {
        key: string;
        media_id: string;
        bytes: number;
        created_at: string;
        remote: number;
      }[]
    ).filter((object) => mediaIds.has(object.media_id));
    const byMedia = new Map<string, typeof objects>();
    for (const object of objects) {
      const values = byMedia.get(object.media_id) || [];
      values.push(object);
      byMedia.set(object.media_id, values);
    }
    const uploads = db
      .prepare(
        `SELECT id,name,size,offset,state,error,created_at FROM uploads WHERE owner_id=? AND state IN ('uploading','queued','processing','failed') ORDER BY created_at DESC LIMIT 100`,
      )
      .all(identity.userId);
    const usage =
      identity.role === "local"
        ? storageUsage()
        : {
            usedBytes: objects.reduce((sum, object) => sum + object.bytes, 0),
            reservedBytes: db
              .prepare(
                "SELECT coalesce(sum(size),0) AS n FROM uploads WHERE owner_id=? AND state IN ('uploading','queued','processing') AND id NOT IN (SELECT media_id FROM objects WHERE key LIKE 'videos/%')",
              )
              .get(identity.userId)!.n as number,
            quotaBytes: storagePolicy().quotaBytes,
            retentionDays: storagePolicy().retentionDays,
          };
    return NextResponse.json(
      {
        usage,
        policy: storagePolicy(),
        storage: cloudEnabled() ? "cloud" : "local",
        videos: sessions.map((session) => {
          const files = byMedia.get(session.videoId) || [];
          const source = files.find(
            (file) => file.key === `videos/${session.videoId}`,
          );
          return {
            sessionId: session.id,
            name: session.name,
            videoId: session.videoId,
            videoName: session.videoName,
            createdAt: session.createdAt,
            bytes: source?.bytes || 0,
            thumbnailReady: files.some(
              (file) => file.key === `thumbnails/${session.videoId}.jpg`,
            ),
            optimizedReady: files.some(
              (file) => file.key === `optimized/${session.videoId}.mp4`,
            ),
          };
        }),
        uploads,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Storage overview failed", error);
    return NextResponse.json(
      { error: "Storage details are unavailable." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  let identity;
  try {
    identity = await appIdentity();
  } catch {
    return NextResponse.json(
      { error: "Authentication is unavailable." },
      { status: 401 },
    );
  }
  if (identity.role !== "local")
    return NextResponse.json(
      { error: "Storage policy changes require an administrator." },
      { status: 403 },
    );
  if (
    !sameRequestOrigin(
      request.headers.get("origin"),
      request.headers.get("host") || new URL(request.url).host,
    )
  )
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = storagePolicySchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid storage policy." },
      { status: 400 },
    );
  try {
    return await withStoreLock(async () => {
      transaction(() => {
        writeDocument("settings", "storage", {
          ...storagePolicy(),
          ...parsed.data,
        });
      });
      return NextResponse.json({
        policy: storagePolicy(),
        usage: storageUsage(),
      });
    });
  } catch (error) {
    console.error("Storage policy save failed", error);
    return NextResponse.json(
      { error: "Storage settings could not be saved." },
      { status: 503 },
    );
  }
}
