import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { ensureObject } from "@/lib/object-store";
import { resolveShareToken } from "@/lib/share-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const resolved = await resolveShareToken(token);
    if (!resolved) return new Response("Not found", { status: 404 });
    const source = await ensureObject(`videos/${resolved.session.videoId}`);
    const { size } = await fs.stat(source);
    let start = 0;
    let end = size - 1;
    let status = 200;
    const headers: Record<string, string> = {
      "Content-Type": resolved.session.videoType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
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
    const stream = createReadStream(source, { start, end });
    request.signal.addEventListener("abort", () => stream.destroy(), {
      once: true,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  } catch (error) {
    console.error("Shared video streaming failed", error);
    return new Response("Video unavailable", { status: 503 });
  }
}
