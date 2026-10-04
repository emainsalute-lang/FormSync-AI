import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { database, transaction } from "@/lib/database";
import { appIdentity } from "@/lib/user-scope";
import { originAllowed } from "@/lib/session-service";
import { pushConfiguration } from "@/lib/push-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await appIdentity();
    const row = database()
      .prepare(
        "SELECT hour,minute,timezone,enabled FROM push_reminders WHERE owner_id=?",
      )
      .get(identity.userId) as
      | { hour: number; minute: number; timezone: string; enabled: number }
      | undefined;
    return NextResponse.json(
      {
        configured: pushConfiguration().configured,
        publicKey: pushConfiguration().publicKey,
        reminder: row
          ? {
              hour: row.hour,
              minute: row.minute,
              timezone: row.timezone,
              enabled: !!row.enabled,
            }
          : null,
        subscribed: Boolean(
          database()
            .prepare(
              "SELECT endpoint_hash FROM push_subscriptions WHERE owner_id=?",
            )
            .get(identity.userId),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Reminder settings unavailable", error);
    return NextResponse.json(
      { error: "Reminder settings are unavailable." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const identity = await appIdentity();
    const body = await request.json();
    const { hour, minute, timezone, subscription } = body;
    let pushHost = "";
    if (typeof subscription?.endpoint === "string") {
      try {
        const endpointUrl = new URL(subscription.endpoint);
        pushHost = endpointUrl.hostname.toLowerCase();
        if (
          endpointUrl.protocol !== "https:" ||
          endpointUrl.username ||
          endpointUrl.password ||
          (endpointUrl.port && endpointUrl.port !== "443")
        )
          pushHost = "";
      } catch {
        pushHost = "";
      }
    }
    const trustedPushHost =
      pushHost === "fcm.googleapis.com" ||
      pushHost === "updates.push.services.mozilla.com" ||
      pushHost === "push.services.mozilla.com" ||
      pushHost === "web.push.apple.com" ||
      pushHost.endsWith(".notify.windows.com");
    if (
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute > 59 ||
      typeof timezone !== "string" ||
      timezone.length > 100 ||
      !subscription ||
      typeof subscription.endpoint !== "string" ||
      subscription.endpoint.length > 2048 ||
      !trustedPushHost ||
      typeof subscription.keys?.p256dh !== "string" ||
      typeof subscription.keys?.auth !== "string"
    )
      return NextResponse.json(
        { error: "Invalid reminder or push subscription." },
        { status: 400 },
      );
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      return NextResponse.json(
        { error: "Choose a valid time zone." },
        { status: 400 },
      );
    }
    if (!pushConfiguration().configured)
      return NextResponse.json(
        { error: "Web Push is not configured on this server." },
        { status: 503 },
      );
    const endpointHash = createHash("sha256")
      .update(subscription.endpoint)
      .digest("hex");
    transaction(() => {
      database()
        .prepare(
          `INSERT INTO push_subscriptions(endpoint_hash,owner_id,endpoint,p256dh,auth,created_at)
         VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET owner_id=excluded.owner_id,endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth`,
        )
        .run(
          endpointHash,
          identity.userId,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth,
          new Date().toISOString(),
        );
      database()
        .prepare(
          `INSERT INTO push_reminders(owner_id,hour,minute,timezone,enabled,last_sent_date)
         VALUES(?,?,?,?,1,NULL) ON CONFLICT(owner_id) DO UPDATE SET hour=excluded.hour,minute=excluded.minute,timezone=excluded.timezone,enabled=1`,
        )
        .run(identity.userId, hour, minute, timezone);
    });
    return NextResponse.json({ enabled: true });
  } catch (error) {
    console.error("Reminder settings could not be saved", error);
    return NextResponse.json(
      { error: "Could not enable reminders." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const identity = await appIdentity();
    database()
      .prepare("DELETE FROM push_subscriptions WHERE owner_id=?")
      .run(identity.userId);
    database()
      .prepare("UPDATE push_reminders SET enabled=0 WHERE owner_id=?")
      .run(identity.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Reminder subscription could not be removed", error);
    return NextResponse.json(
      { error: "Could not disable reminders." },
      { status: 503 },
    );
  }
}
