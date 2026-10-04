import { NextResponse } from "next/server";
import { beginUpload } from "@/lib/upload-service";
import { originAllowed } from "@/lib/session-service";
import { appIdentity } from "@/lib/user-scope";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recordProductEvent } from "@/lib/operations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    if (Number(request.headers.get("content-length")) > 2048)
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const identity = await appIdentity();
    if (identity.role === "coach")
      return NextResponse.json(
        { error: "Coaches cannot upload athlete videos." },
        { status: 403 },
      );
    if (
      !consumeRateLimit(`upload:${identity.userId}`, 10, 60 * 60 * 1000).allowed
    )
      return NextResponse.json(
        { error: "Upload limit reached. Try again later." },
        { status: 429 },
      );
    const { name, type, size } = await request.json();
    const upload = await beginUpload(name, type, size, identity.userId);
    recordProductEvent("upload_started", identity.userId);
    return NextResponse.json(upload, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: Number((e as { status?: number }).status) || 400 },
    );
  }
}
