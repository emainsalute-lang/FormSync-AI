import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { database } from "@/lib/database";
import { ensureObject } from "@/lib/object-store";
import { validId } from "@/lib/media-service";
import { appIdentity, canAccessMedia } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; asset: string }> },
) {
  const { id, asset } = await params;
  if (!validId(id) || !["thumbnail", "optimized"].includes(asset))
    return new Response("Not found", { status: 404 });
  try {
    const identity = await appIdentity();
    if (!(await canAccessMedia(identity, id)))
      return new Response("Not found", { status: 404 });
  } catch (error) {
    console.error("Media identity lookup failed", error);
    return new Response("Authentication unavailable", { status: 401 });
  }
  const key =
    asset === "thumbnail" ? `thumbnails/${id}.jpg` : `optimized/${id}.mp4`;
  const row = database()
    .prepare("SELECT key FROM objects WHERE key=?")
    .get(key);
  if (!row) return new Response("Not found", { status: 404 });
  try {
    const file = await ensureObject(key);
    const { size } = await fs.stat(file);
    const type = asset === "thumbnail" ? "image/jpeg" : "video/mp4";
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = request.headers.get("range");
    if (asset === "optimized" && range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        start = Math.max(0, size - suffix);
      } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      }
      if (
        start >= size ||
        end < start ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end)
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    const stream = createReadStream(file, { start, end });
    request.signal.addEventListener("abort", () => stream.destroy(), {
      once: true,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response("Not found", { status: 404 });
    console.error("Generated media asset read failed", key, error);
    return new Response("Media asset unavailable", { status: 503 });
  }
}
