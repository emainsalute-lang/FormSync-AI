import { NextResponse } from "next/server";
import { importMedia, MediaError } from "@/lib/media-service";
import { MAX_VIDEO_BYTES, sameRequestOrigin } from "@/lib/validation";
import { appIdentity } from "@/lib/user-scope";
import { consumeRateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
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
  if (
    Number(request.headers.get("content-length")) >
    MAX_VIDEO_BYTES + 1024 * 1024
  )
    return NextResponse.json(
      { error: "Upload exceeds 100 MB." },
      { status: 413 },
    );
  try {
    const form = await request.formData();
    const file = form.get("video");
    if (!(file instanceof File))
      return NextResponse.json({ error: "Choose a video." }, { status: 400 });
    const identity = await appIdentity();
    if (identity.role === "coach")
      return NextResponse.json(
        { error: "Coaches cannot upload athlete videos." },
        { status: 403 },
      );
    if (
      !consumeRateLimit(`media:${identity.userId}`, 10, 60 * 60 * 1000).allowed
    )
      return NextResponse.json(
        { error: "Upload limit reached. Try again later." },
        { status: 429 },
      );
    return NextResponse.json(await importMedia(file, identity.userId), {
      status: 201,
    });
  } catch (error) {
    console.error("Video preparation failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof MediaError
            ? error.message
            : "Video preparation failed. Please retry.",
      },
      { status: error instanceof MediaError ? error.status : 503 },
    );
  }
}
