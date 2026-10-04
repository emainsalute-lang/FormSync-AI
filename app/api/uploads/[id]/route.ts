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
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
    const upload = action === "post" ? await completeUpload(id) : existing;
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
