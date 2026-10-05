import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { ensureObject } from "@/lib/object-store";
import { videoPath } from "@/lib/storage";
import { findMedia } from "@/lib/media-service";
import { appIdentity, canAccessMedia } from "@/lib/user-scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    return new Response("Not found", { status: 404 });
  try {
    const identity = await appIdentity();
    if (!(await canAccessMedia(identity, id)))
      return new Response("Not found", { status: 404 });
    const session = await findMedia(id);
    if (!session) return new Response("Not found", { status: 404 });
    let optimized = new URL(request.url).searchParams.get("optimized") === "1";
    let file = videoPath(id);
    if (optimized) {
      try {
        file = await ensureObject(`optimized/${id}.mp4`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        optimized = false;
      }
    }
    const { size } = await fs.stat(file);
    const headers: Record<string, string> = {
      "Content-Type": optimized ? "video/mp4" : session.type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    let start = 0,
      end = size - 1,
      status = 200;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (suffix <= 0)
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
    console.error("Video read failed", error);
    return new Response("Video unavailable", { status: 503 });
  }
}
