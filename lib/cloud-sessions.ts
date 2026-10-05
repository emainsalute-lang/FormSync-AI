import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "./supabase/server";
import {
  checkCloud,
  cloudError,
  cloudMedia,
  cloudSession,
  removeUnusedCloudVideo,
} from "./cloud-store";
import { transformCloudVideo } from "./cloud-processing";
import { sessionInput } from "./validation";
import { calculateSessionLoad, type Session } from "./model";
import { rotateDrawings, remapTrimmedDrawings } from "./media-model";
import type { AppIdentity } from "./user-scope";

export async function writeCloudSession(
  request: Request,
  identity: AppIdentity,
  id?: string,
) {
  try {
    if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024)
      throw cloudError(
        "Session data exceeds 2 MB. Upload videos directly first.",
        413,
      );
    const form = await request.formData();
    const raw = form.get("session");
    if (typeof raw !== "string" || raw.length > 1024 * 1024)
      throw cloudError("Invalid session data.", 400);
    const input = sessionInput.parse(JSON.parse(raw));
    if (!input.videoId)
      throw cloudError("Finish uploading the video before saving.", 400);
    const prior = id ? await cloudSession(id, identity.userId) : null;
    if (id && !prior) throw cloudError("Session not found.", 404);
    if (prior && input.revision !== prior.revision)
      throw cloudError(
        "Session changed in another tab. Reopen it before updating.",
        409,
      );
    let media = await cloudMedia(input.videoId);
    if (
      media.owner_id !== identity.userId ||
      media.state !== "ready" ||
      !media.info
    )
      throw cloudError("Video is not ready to save.", 409);
    const original = media.info;
    const end = input.trimEnd ?? original.duration;
    if (end > original.duration + 0.02 || end <= input.trimStart)
      throw cloudError("Choose a valid trim range.", 400);
    let drawings: Session["drawings"] = input.drawings;
    if (
      input.trimStart > 0.0001 ||
      end < original.duration - 0.0001 ||
      input.rotation !== 0
    ) {
      media = await transformCloudVideo(
        media,
        input.trimStart,
        end,
        input.rotation,
      );
      drawings = remapTrimmedDrawings(
        rotateDrawings(
          drawings,
          input.rotation,
          original.width,
          original.height,
          media.info!.width,
          media.info!.height,
        ),
        original.frames,
        media.info!.frames,
        input.trimStart,
        end,
      );
    }
    const now = new Date().toISOString();
    const durationMinutes =
      input.durationMinutes === undefined
        ? (prior?.durationMinutes ?? null)
        : input.durationMinutes;
    const sessionRpe =
      input.sessionRpe === undefined
        ? (prior?.sessionRpe ?? null)
        : input.sessionRpe;
    const body: Session = {
      ...input,
      id: id || randomUUID(),
      ownerId: identity.userId,
      drawings,
      rotation: 0,
      fps: media.info!.fps,
      videoId: media.id,
      videoName: media.name,
      videoType: "video/mp4",
      createdAt: prior?.createdAt || now,
      updatedAt: now,
      revision: randomUUID(),
      durationMinutes,
      sessionRpe,
      sessionLoad: calculateSessionLoad(durationMinutes, sessionRpe),
    };
    const client = await createSupabaseServerClient();
    const record = {
      id: body.id,
      owner_id: identity.userId,
      media_id: media.id,
      revision: body.revision,
      body,
    };
    if (id) {
      const result = await client
        .from("formsync_sessions")
        .update(record)
        .eq("id", id)
        .eq("owner_id", identity.userId)
        .eq("revision", input.revision!)
        .select("id")
        .maybeSingle();
      checkCloud(result.error);
      if (!result.data)
        throw cloudError(
          "Session changed in another tab. Reopen it before updating.",
          409,
        );
    } else
      checkCloud((await client.from("formsync_sessions").insert(record)).error);
    return NextResponse.json(body, { status: id ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Session could not be saved.",
      },
      { status: Number((error as { status?: number }).status) || 400 },
    );
  }
}
export async function deleteCloudSession(
  request: Request,
  identity: AppIdentity,
  id: string,
) {
  const revision = request.headers.get("if-match")?.replace(/^"|"$/g, "");
  if (!revision)
    return NextResponse.json(
      { error: "Reload the session before deleting." },
      { status: 428 },
    );
  const client = await createSupabaseServerClient();
  const prior = await cloudSession(id, identity.userId);
  const result = await client
    .from("formsync_sessions")
    .delete()
    .eq("id", id)
    .eq("owner_id", identity.userId)
    .eq("revision", revision)
    .select("id")
    .maybeSingle();
  checkCloud(result.error);
  if (!result.data)
    return NextResponse.json(
      { error: "Session changed or was deleted. Reload history." },
      { status: 409 },
    );
  if (prior)
    await removeUnusedCloudVideo(prior.videoId).catch((error) =>
      console.error("Cloud video cleanup failed after session deletion", error),
    );
  return new Response(null, { status: 204 });
}
