import { NextResponse } from "next/server";
import { appIdentity } from "@/lib/user-scope";
import { createCalendarFeed, revokeCalendarFeed } from "@/lib/calendar-feed";
import { originAllowed } from "@/lib/session-service";
import { database } from "@/lib/database";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await appIdentity();
    const row = database()
      .prepare(
        "SELECT created_at,revoked_at FROM calendar_feeds WHERE owner_id=?",
      )
      .get(identity.userId) as
      { created_at: string; revoked_at: string | null } | undefined;
    return NextResponse.json({
      active: Boolean(row && !row.revoked_at),
      createdAt: row?.created_at || null,
    });
  } catch (error) {
    console.error("Calendar feed status unavailable", error);
    return NextResponse.json(
      { error: "Calendar sync is unavailable." },
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
      !consumeRateLimit(`calendar-feed:${identity.userId}`, 5, 60 * 60 * 1000)
        .allowed
    )
      return NextResponse.json(
        { error: "Calendar link rotation limit reached. Try again later." },
        { status: 429 },
      );
    if (!identity.userId)
      return NextResponse.json(
        { error: "Sign in to create a calendar feed." },
        { status: 401 },
      );
    const token = createCalendarFeed(identity.userId);
    return NextResponse.json(
      { path: `/api/calendar/${token}` },
      { status: 201 },
    );
  } catch (error) {
    console.error("Calendar feed creation failed", error);
    return NextResponse.json(
      { error: "Could not create calendar feed." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const identity = await appIdentity();
    if (!revokeCalendarFeed(identity.userId))
      return NextResponse.json(
        { error: "Calendar feed not found." },
        { status: 404 },
      );
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Calendar feed revocation failed", error);
    return NextResponse.json(
      { error: "Could not revoke calendar feed." },
      { status: 503 },
    );
  }
}
