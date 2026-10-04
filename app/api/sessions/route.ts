import { NextResponse } from "next/server";
import { listSessions } from "@/lib/storage";
import { writeSessionRequest } from "@/lib/session-service";
import { appIdentity } from "@/lib/user-scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const identity = await appIdentity();
    return NextResponse.json(
      await listSessions(identity.userId, identity.accessibleOwnerIds),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Session load failed", error);
    return NextResponse.json(
      { error: "Sessions could not be loaded. Please retry." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    return writeSessionRequest(request, await appIdentity());
  } catch (error) {
    console.error("Session identity lookup failed", error);
    return NextResponse.json(
      { error: "Authentication is unavailable." },
      { status: 401 },
    );
  }
}
