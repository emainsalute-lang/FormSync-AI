import { NextResponse } from "next/server";
import { getSession } from "@/lib/storage";
import { originAllowed } from "@/lib/session-service";
import { MediaError } from "@/lib/media-service";
import { exportAnnotatedVideo } from "@/lib/video-export";
import { appIdentity } from "@/lib/user-scope";
import { consumeRateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let active = 0;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (active >= 2)
    return NextResponse.json(
      { error: "Video exports are busy. Try again shortly." },
      { status: 503 },
    );
  active++;
  try {
    const identity = await appIdentity();
    if (
      !consumeRateLimit(`export:${identity.userId}`, 10, 60 * 60 * 1000).allowed
    )
      return NextResponse.json(
        { error: "Export limit reached. Try again later." },
        { status: 429 },
      );
    const { id } = await params;
    const s = await getSession(
      id,
      identity.userId,
      identity.accessibleOwnerIds,
    );
    if (!s)
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (
      request.headers.get("if-match")?.replace(/^"|"$/g, "") !==
      (s.revision || s.createdAt)
    )
      return NextResponse.json(
        { error: "Session changed. Refresh before exporting." },
        { status: 409 },
      );
    const bytes = await exportAnnotatedVideo(s);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="formsync-${s.id}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Video export failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof MediaError
            ? e.message
            : "Video export failed. Try a shorter clip.",
      },
      { status: e instanceof MediaError ? e.status : 503 },
    );
  } finally {
    active--;
  }
}
