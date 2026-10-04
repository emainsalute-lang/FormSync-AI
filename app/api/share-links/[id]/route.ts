import { NextResponse } from "next/server";
import { appIdentity } from "@/lib/user-scope";
import { revokeShareLink } from "@/lib/share-links";
import { originAllowed } from "@/lib/session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const identity = await appIdentity();
    if (!revokeShareLink((await params).id, identity.userId))
      return NextResponse.json(
        { error: "Share link not found." },
        { status: 404 },
      );
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Share link revocation failed", error);
    return NextResponse.json(
      { error: "Could not revoke the share link." },
      { status: 503 },
    );
  }
}
