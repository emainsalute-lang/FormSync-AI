import { NextResponse } from "next/server";
import { listSessions } from "@/lib/storage";
import { readWorkspace } from "@/lib/training-store";
import { cloudEnabled } from "@/lib/object-store";
import { appIdentity } from "@/lib/user-scope";
import { timingSafeEqual } from "node:crypto";
import { database } from "@/lib/database";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const healthToken = process.env.FORMSYNC_HEALTH_TOKEN;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (healthToken && supplied) {
    const left = Buffer.from(healthToken);
    const right = Buffer.from(supplied);
    if (left.length === right.length && timingSafeEqual(left, right)) {
      try {
        database().prepare("SELECT 1").get();
        return NextResponse.json(
          {
            status: "ok",
            uptimeSeconds: Math.round(process.uptime()),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        console.error("Health database check failed", error);
        return NextResponse.json({ status: "unavailable" }, { status: 503 });
      }
    }
  }
  try {
    const identity = await appIdentity();
    const [sessions, w] = await Promise.all([
      listSessions(identity.userId, identity.accessibleOwnerIds),
      readWorkspace(identity.userId),
    ]);
    return NextResponse.json(
      {
        status: "ok",
        sessions: sessions.length,
        plans: w.plans.length,
        storage: cloudEnabled()
          ? "S3-compatible object storage"
          : "local filesystem",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
}
