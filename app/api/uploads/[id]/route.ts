import { NextResponse } from "next/server";
import {
  uploadRecord,
  appendChunk,
  completeUpload,
  cancelUpload,
  CHUNK_BYTES,
} from "@/lib/upload-service";
import { originAllowed } from "@/lib/session-service";
import { validId, getMediaInfo } from "@/lib/media-service";
import { appIdentity } from "@/lib/user-scope";
import { consumeRateLimit } from "@/lib/rate-limit";
import { workerTick } from "@/lib/processing-worker";
import { cloudStorageEnabled, VIDEO_BUCKET } from "@/lib/cloud-config";
import {
  cloudMedia,
  cloudUploadStatus,
  checkCloud,
  mediaObject,
} from "@/lib/cloud-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { processCloudUpload } from "@/lib/cloud-processing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
async function perform(request: Request, context: Context, action: string) {
  const { id } = await context.params;
  if (!validId(id))
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (action !== "get" && !originAllowed(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    const identity = await appIdentity();
    if (identity.role === "coach")
      return NextResponse.json(
        { error: "Coaches cannot access athlete uploads." },
        { status: 403 },
      );
    if (cloudStorageEnabled()) {
      let row = await cloudMedia(id);
      if (row.owner_id !== identity.userId)
        return NextResponse.json(
          { error: "Upload not found" },
          { status: 404 },
        );
      if (action === "patch")
        return NextResponse.json(
          { error: "Upload chunks directly to Supabase." },
          { status: 400 },
        );
      if (action === "delete") {
        if (!["uploading", "cancelled"].includes(row.state))
          return NextResponse.json(
            { error: "Processing has started. Remove the video from Storage." },
            { status: 409 },
          );
        const client = await createSupabaseServerClient();
        const cancelled = await client
          .from("formsync_media")
          .update({ state: "cancelled" })
          .eq("id", id)
          .in("state", ["uploading", "cancelled"])
          .select("id")
          .maybeSingle();
        checkCloud(cancelled.error);
        if (!cancelled.data)
          return NextResponse.json(
            { error: "Processing has started. Remove the video from Storage." },
            { status: 409 },
          );
        checkCloud(
          (
            await client.storage
              .from(VIDEO_BUCKET)
              .remove([mediaObject(row, "original")])
          ).error,
        );
        return new Response(null, { status: 204 });
      }
      if (action === "post" || row.state === "processing")
        row = await processCloudUpload(id);
      return NextResponse.json(await cloudUploadStatus(row), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const existing = uploadRecord(id);
    if (!existing || existing.owner_id !== identity.userId)
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    if (
      action === "patch" &&
      !consumeRateLimit(`upload-chunks:${identity.userId}`, 600, 60 * 1000)
        .allowed
    )
      return NextResponse.json(
        { error: "Upload is sending too many chunks. Retry shortly." },
        { status: 429 },
      );
    if (action === "delete") {
      await cancelUpload(id);
      return new Response(null, { status: 204 });
    }
    if (action === "patch") {
      if (Number(request.headers.get("content-length")) > CHUNK_BYTES)
        throw Object.assign(new Error("Chunk too large"), { status: 413 });
      const rawOffset = request.headers.get("upload-offset");
      if (rawOffset === null || !/^\d+$/.test(rawOffset))
        throw Object.assign(new Error("Upload-Offset is required"), {
          status: 400,
        });
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!request.body) throw new Error("Chunk body is required");
      const reader = request.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > CHUNK_BYTES) {
          await reader.cancel();
          throw Object.assign(new Error("Chunk too large"), { status: 413 });
        }
        chunks.push(value);
      }
      return NextResponse.json(
        await appendChunk(id, Number(rawOffset), Buffer.concat(chunks)),
      );
    }
    let upload = action === "post" ? await completeUpload(id) : existing;
    if (
      ["queued", "processing"].includes(upload.state) &&
      process.env.FORMSYNC_EMBEDDED_WORKER !== "false"
    ) {
      // Keep processing within the request lifetime on hosts that suspend timers.
      await workerTick(id);
      upload = uploadRecord(id)!;
    }
    if (!upload)
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    return NextResponse.json(
      {
        ...upload,
        media: upload.state === "ready" ? await getMediaInfo(id) : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: Number((e as { status?: number }).status) || 503 },
    );
  }
}
export const GET = (r: Request, c: Context) => perform(r, c, "get");
export const PATCH = (r: Request, c: Context) => perform(r, c, "patch");
export const POST = (r: Request, c: Context) => perform(r, c, "post");
export const DELETE = (r: Request, c: Context) => perform(r, c, "delete");
