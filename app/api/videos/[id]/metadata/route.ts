import { NextResponse } from "next/server";
import { getMediaInfo, MediaError } from "@/lib/media-service";
import { appIdentity, canAccessMedia } from "@/lib/user-scope";
import { cloudStorageEnabled } from "@/lib/cloud-config";
import { cloudMedia } from "@/lib/cloud-store";
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
    if (cloudStorageEnabled()) {
      const row = await cloudMedia(id);
      if (!row.info || row.state !== "ready")
        return NextResponse.json(
          { error: row.error || "Video is not ready." },
          { status: 409 },
        );
      return NextResponse.json(row.info, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
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
