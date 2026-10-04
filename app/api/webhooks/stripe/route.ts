import { NextResponse } from "next/server";
import { recordOperationalEvent } from "@/lib/operations";
import { saveStripeEvent, validStripeSignature } from "@/lib/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1024 * 1024)
    return NextResponse.json(
      { error: "Webhook payload too large." },
      { status: 413 },
    );
  if (!validStripeSignature(raw, request.headers.get("stripe-signature")))
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 },
    );
  try {
    const event = JSON.parse(raw);
    if (
      typeof event.id !== "string" ||
      typeof event.type !== "string" ||
      !event.data?.object
    )
      return NextResponse.json(
        { error: "Invalid event payload." },
        { status: 400 },
      );
    saveStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    recordOperationalEvent(
      "stripe-webhook",
      "error",
      error instanceof Error ? error.message : "Webhook processing failed",
    );
    console.error("Stripe webhook processing failed", error);
    return NextResponse.json(
      { error: "Webhook processing failed; Stripe may retry." },
      { status: 500 },
    );
  }
}
