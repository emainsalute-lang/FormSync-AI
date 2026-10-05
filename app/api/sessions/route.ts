import { NextResponse } from "next/server";
import { listSessions } from "@/lib/storage";
import { writeSessionRequest } from "@/lib/session-service";
import { appIdentity } from "@/lib/user-scope";
import { cloudStorageEnabled } from "@/lib/cloud-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
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
      {
        error:
          cloudStorageEnabled() && error instanceof Error
            ? error.message
            : "Sessions could not be loaded. Please retry.",
      },
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
