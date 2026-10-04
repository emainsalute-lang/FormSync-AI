import { NextResponse } from "next/server";
import { appIdentity } from "@/lib/user-scope";
import { getSession } from "@/lib/storage";
import { createShareLink, listShareLinks } from "@/lib/share-links";
import { consumeRateLimit } from "@/lib/rate-limit";
import { originAllowed } from "@/lib/session-service";
import { recordOperationalEvent } from "@/lib/operations";
import { recordProductEvent } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await appIdentity();
    const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
    const session = await getSession(sessionId, identity.userId);
    if (!session)
      return NextResponse.json(
        { error: "Session not found." },
        { status: 404 },
      );
    return NextResponse.json(listShareLinks(sessionId, identity.userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Share links could not be loaded", error);
    return NextResponse.json(
      { error: "Sharing is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const identity = await appIdentity();
    if (
      !consumeRateLimit(`share:${identity.userId}`, 10, 60 * 60 * 1000).allowed
    )
      return NextResponse.json(
        { error: "Too many links created. Try later." },
        { status: 429 },
      );
    const body = await request.json();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const days = body.expiresInDays;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365))
      return NextResponse.json(
        { error: "Expiration must be 1–365 days or never." },
        { status: 400 },
      );
    if (identity.role === "coach")
      return NextResponse.json(
        { error: "Only athletes can share their sessions." },
        { status: 403 },
      );
    const session = await getSession(sessionId, identity.userId);
    if (!session)
      return NextResponse.json(
        { error: "Session not found." },
        { status: 404 },
      );
    const link = createShareLink(sessionId, identity.userId, days);
    recordOperationalEvent("share-link", "info", "Share link created", {
      ownerId: identity.userId,
    });
    recordProductEvent("share_link_created", identity.userId);
    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    console.error("Share link creation failed", error);
    return NextResponse.json(
      { error: "Could not create a share link." },
      { status: 503 },
    );
  }
}
