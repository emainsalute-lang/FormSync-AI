import "server-only";
import { promises as fs } from "node:fs";
import { videoPath } from "./storage";
import { readWorkspace, saveWorkspace } from "./training-store";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getSession,
  listSessions,
  saveSession,
  setMediaOwner,
  deleteSessionRecord,
  withStoreLock,
} from "./storage";
import { withMediaLock } from "./media-lock";
import {
  getMediaInfo,
  importMedia,
  trimMedia,
  removeMedia,
  validId,
  MediaError,
} from "./media-service";
import { MAX_VIDEO_BYTES, sameRequestOrigin, sessionInput } from "./validation";
import { calculateSessionLoad, type Session } from "./model";
import { remapTrimmedDrawings, rotateDrawings } from "./media-model";
import { canAccessMedia, type AppIdentity } from "./user-scope";
import { consumeRateLimit } from "./rate-limit";
import { recordOperationalEvent, recordProductEvent } from "./operations";
import { assertSessionCapacity } from "./plan-limits";
import { cloudStorageEnabled } from "./cloud-config";
import { writeCloudSession, deleteCloudSession } from "./cloud-sessions";
export function originAllowed(request: Request) {
  return sameRequestOrigin(
    request.headers.get("origin"),
    request.headers.get("host") || new URL(request.url).host,
  );
}
export async function cleanupUnusedMedia(id: string) {
  await withMediaLock(id, () =>
    withStoreLock(async () => {
      if (!(await listSessions()).some((s) => s.videoId === id))
        await removeMedia(id);
    }),
  );
}
export async function writeSessionRequest(
  request: Request,
  identity: AppIdentity,
  id?: string,
) {
  if (!originAllowed(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  if (id && !validId(id))
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (identity.role === "coach")
    return NextResponse.json(
      { error: "Coaches cannot create or edit athlete sessions." },
      { status: 403 },
    );
  if (cloudStorageEnabled()) return writeCloudSession(request, identity, id);
  if (
    !consumeRateLimit(`session-write:${identity.userId}`, 40, 60 * 60 * 1000)
      .allowed
  )
    return NextResponse.json(
      { error: "Too many session changes. Try again later." },
      { status: 429 },
    );
  if (
    Number(request.headers.get("content-length")) >
    MAX_VIDEO_BYTES + 2 * 1024 * 1024
  )
    return NextResponse.json(
      { error: "Upload exceeds 100 MB." },
      { status: 413 },
    );
  const createdMedia: string[] = [];
  try {
    const form = await request.formData();
    const raw = form.get("session");
    if (typeof raw !== "string" || raw.length > 1024 * 1024)
      throw new MediaError("Invalid session data.");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new MediaError("Invalid session data.");
    }
    const parsed = sessionInput.safeParse(json);
    if (!parsed.success)
      throw new MediaError(
        parsed.error.issues[0]?.message || "Check session details.",
      );
    const data = parsed.data;
    if (!id) assertSessionCapacity(identity.userId);
    const prior = id ? await getSession(id, identity.userId) : null;
    if (id && !prior)
      throw new MediaError(
        "This session was deleted. Start a new session to save your draft.",
        404,
      );
    if (prior && data.revision !== (prior.revision || prior.createdAt))
      throw new MediaError(
        "This session changed in another tab. Reopen it before updating.",
        409,
      );
    const file = form.get("video");
    let media;
    if (file instanceof File && file.size) {
      media = await importMedia(file, identity.userId);
      createdMedia.push(media.id);
    } else if (data.videoId) {
      if (!(await canAccessMedia(identity, data.videoId)))
        throw new MediaError("Video not found.", 404);
      media = await getMediaInfo(data.videoId);
    } else throw new MediaError("Upload a video before saving.");
    const trimEnd = data.trimEnd ?? media.duration;
    const trimming =
      data.trimStart > 0.0001 || trimEnd < media.duration - 0.0001;
    if (trimEnd > media.duration + 0.02 || trimEnd <= data.trimStart)
      throw new MediaError("Choose a valid trim range.");
    let drawings: Session["drawings"] = data.drawings;
    const processing = trimming || data.rotation !== 0;
    if (processing) {
      const original = media;
      media = await trimMedia(
        original,
        data.trimStart,
        trimEnd,
        data.rotation,
        identity.userId,
      );
      createdMedia.push(media.id);
      drawings = rotateDrawings(
        drawings,
        data.rotation,
        original.width,
        original.height,
        media.width,
        media.height,
      );
      drawings = remapTrimmedDrawings(
        drawings,
        original.frames,
        media.frames,
        data.trimStart,
        trimEnd,
      );
    }
    const now = new Date().toISOString();
    const durationMinutes =
      data.durationMinutes === undefined
        ? (prior?.durationMinutes ?? null)
        : data.durationMinutes;
    const sessionRpe =
      data.sessionRpe === undefined
        ? (prior?.sessionRpe ?? null)
        : data.sessionRpe;
    const record: Session = {
      id: id || randomUUID(),
      name: data.name,
      date: data.date,
      makes: data.makes,
      misses: data.misses,
      reps: data.reps,
      target: data.target,
      durationMinutes,
      sessionRpe,
      sessionLoad: calculateSessionLoad(durationMinutes, sessionRpe),
      notes: data.notes,
      tags: data.tags,
      fps: media.fps,
      drawings,
      rotation: processing ? 0 : data.rotation,
      videoId: media.id,
      videoName: media.name,
      videoType: media.type,
      ownerId: identity.userId,
      createdAt: prior?.createdAt || now,
      updatedAt: now,
      revision: randomUUID(),
    };
    await withStoreLock(async () => {
      if (!id) assertSessionCapacity(identity.userId);
      if (id) {
        const current = await getSession(id, identity.userId);
        if (!current) throw new MediaError("This session was deleted.", 404);
        if (data.revision !== (current.revision || current.createdAt))
          throw new MediaError(
            "This session changed in another tab. Reopen it before updating.",
            409,
          );
      }
      await fs.access(videoPath(record.videoId)).catch(() => {
        throw new MediaError(
          "This video was deleted in another tab. Upload it again before saving.",
          409,
        );
      });
      recordOperationalEvent(
        "session-save",
        "info",
        id ? "Session updated" : "Session created",
        { ownerId: identity.userId },
      );
      recordProductEvent(
        id ? "session_updated" : "session_created",
        identity.userId,
      );
      await saveSession(record);
      if (id)
        await pruneTraining(id, false, identity.userId).catch((e) =>
          console.error("Training cleanup failed", e),
        );
    });
    if (prior && prior.videoId !== record.videoId)
      await cleanupUnusedMedia(prior.videoId).catch((error) =>
        console.error("Old video cleanup failed", error),
      );
    for (const created of createdMedia)
      if (created !== record.videoId)
        await cleanupUnusedMedia(created).catch((error) =>
          console.error("Temporary video cleanup failed", error),
        );
    return NextResponse.json(record, { status: id ? 200 : 201 });
  } catch (error) {
    for (const created of createdMedia)
      await cleanupUnusedMedia(created).catch(() => {});
    console.error("Session write failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof MediaError
            ? error.message
            : "Could not save this session. Your draft is still available; please retry.",
      },
      { status: error instanceof MediaError ? error.status : 503 },
    );
  }
}
export async function deleteSessionRequest(
  request: Request,
  identity: AppIdentity,
  id: string,
) {
  if (!originAllowed(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  if (!validId(id))
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (identity.role === "coach")
    return NextResponse.json(
      { error: "Coaches cannot delete athlete sessions." },
      { status: 403 },
    );
  if (cloudStorageEnabled()) return deleteCloudSession(request, identity, id);
  if (
    !consumeRateLimit(`session-delete:${identity.userId}`, 30, 60 * 60 * 1000)
      .allowed
  )
    return NextResponse.json(
      { error: "Too many session deletions. Try again later." },
      { status: 429 },
    );
  let deletedVideoId: string | undefined;
  try {
    await withStoreLock(async () => {
      const session = await getSession(id, identity.userId);
      if (!session) throw new MediaError("Session not found.", 404);
      const match = request.headers.get("if-match")?.replace(/^"|"$/g, "");
      if (!match)
        throw new MediaError("Reload the session before deleting.", 428);
      if (match !== (session.revision || session.createdAt))
        throw new MediaError(
          "This session changed in another tab. Reload before deleting.",
          409,
        );
      await deleteSessionRecord(id);
      deletedVideoId = session.videoId;
      await pruneTraining(id, true, identity.userId).catch((e) =>
        console.error("Training cleanup failed", e),
      );
    });
    if (deletedVideoId)
      await cleanupUnusedMedia(deletedVideoId).catch((error) =>
        console.error("Video cleanup failed after deletion", error),
      );
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Session deletion failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof MediaError
            ? error.message
            : "Could not delete this session. Please retry.",
      },
      { status: error instanceof MediaError ? error.status : 503 },
    );
  }
}

async function pruneTraining(
  sessionId: string,
  deleted: boolean,
  ownerId: string,
) {
  const w = await readWorkspace(ownerId);
  const analyses = w.analyses.filter((a) => a.sessionId !== sessionId),
    comments = deleted
      ? w.comments.filter((c) => c.sessionId !== sessionId)
      : w.comments;
  if (
    analyses.length !== w.analyses.length ||
    comments.length !== w.comments.length
  )
    await saveWorkspace({ ...w, analyses, comments }, ownerId);
}
