import {
  writeSessionRequest,
  deleteSessionRequest,
} from "@/lib/session-service";
import { appIdentity } from "@/lib/user-scope";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return writeSessionRequest(request, await appIdentity(), (await params).id);
  } catch (error) {
    console.error("Session identity lookup failed", error);
    return NextResponse.json(
      { error: "Authentication is unavailable." },
      { status: 401 },
    );
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return deleteSessionRequest(
      request,
      await appIdentity(),
      (await params).id,
    );
  } catch (error) {
    console.error("Session identity lookup failed", error);
    return NextResponse.json(
      { error: "Authentication is unavailable." },
      { status: 401 },
    );
  }
}
