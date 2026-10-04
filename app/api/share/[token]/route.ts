import { NextResponse } from "next/server";
import { resolveShareToken } from "@/lib/share-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const resolved = await resolveShareToken((await params).token);
    if (!resolved)
      return NextResponse.json(
        { error: "This share link is invalid or expired." },
        { status: 404 },
      );
    const { session, link } = resolved;
    return NextResponse.json(
      {
        session,
        videoUrl: `/api/share/${(await params).token}/video`,
        expiresAt: link.expires_at,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Shared session lookup failed", error);
    return NextResponse.json(
      { error: "Shared video is unavailable." },
      { status: 503 },
    );
  }
}
