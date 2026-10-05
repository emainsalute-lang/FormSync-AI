import { NextResponse } from "next/server";
import { decodeFrame, MediaError } from "@/lib/media-service";
import { appIdentity, canAccessMedia } from "@/lib/user-scope";
import { consumeRateLimit } from "@/lib/rate-limit";
import { cloudStorageEnabled } from "@/lib/cloud-config";
import { cloudFrame } from "@/lib/cloud-processing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const value = new URL(request.url).searchParams.get("index");
  if (!value || !/^\d+$/.test(value))
    return NextResponse.json(
      { error: "A valid frame index is required." },
      { status: 400 },
    );
  try {
    const id = (await params).id;
    const identity = await appIdentity();
    if (
      !cloudStorageEnabled() &&
      !consumeRateLimit(`frame:${identity.userId}`, 600, 60 * 1000).allowed
    )
      return NextResponse.json(
        { error: "Frame request limit reached. Retry shortly." },
        { status: 429 },
      );
    if (!(await canAccessMedia(identity, id)))
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    const frame = cloudStorageEnabled()
      ? await cloudFrame(id, Number(value))
      : await decodeFrame(id, Number(value));
    return new Response(new Uint8Array(frame), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof MediaError
            ? error.message
            : "Could not decode this frame.",
      },
      { status: error instanceof MediaError ? error.status : 503 },
    );
  }
}
