import { NextResponse } from "next/server";
import { getMediaInfo, MediaError } from "@/lib/media-service";
import { appIdentity, canAccessMedia } from "@/lib/user-scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = (await params).id;
    const identity = await appIdentity();
    if (!(await canAccessMedia(identity, id)))
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    return NextResponse.json(await getMediaInfo(id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof MediaError
            ? error.message
            : "Video indexing is unavailable.",
      },
      { status: error instanceof MediaError ? error.status : 503 },
    );
  }
}
