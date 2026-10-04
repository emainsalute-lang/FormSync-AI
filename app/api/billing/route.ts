import { NextResponse } from "next/server";
import { database } from "@/lib/database";
import { appIdentity } from "@/lib/user-scope";
import { ownerUsage } from "@/lib/plan-limits";
import { originAllowed } from "@/lib/session-service";
import {
  stripeConfigured,
  stripePrice,
  stripeRequest,
  type BillablePlan,
} from "@/lib/stripe-billing";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recordProductEvent } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await appIdentity();
    const row = database()
      .prepare(
        "SELECT stripe_customer_id,plan,status,current_period_end FROM subscriptions WHERE owner_id=?",
      )
      .get(identity.userId) as
      | {
          stripe_customer_id: string | null;
          plan: string;
          status: string;
          current_period_end: string | null;
        }
      | undefined;
    let invoices: {
      id: string;
      amount_paid: number;
      currency: string;
      status: string;
      created: number;
      hosted_invoice_url: string | null;
      invoice_pdf: string | null;
    }[] = [];
    if (row?.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
      const data = await stripeRequest(
        `invoices?customer=${encodeURIComponent(row.stripe_customer_id)}&limit=10`,
      );
      invoices = (data.data || []).map(
        (invoice: (typeof invoices)[number]) => ({
          id: invoice.id,
          amount_paid: invoice.amount_paid,
          currency: invoice.currency,
          status: invoice.status,
          created: invoice.created,
          hosted_invoice_url: invoice.hosted_invoice_url,
          invoice_pdf: invoice.invoice_pdf,
        }),
      );
    }
    return NextResponse.json(
      {
        configured: stripeConfigured(),
        prices: {
          pro: Boolean(stripePrice("pro")),
          team: Boolean(stripePrice("team")),
        },
        subscription: row
          ? {
              plan: row.plan,
              status: row.status,
              currentPeriodEnd: row.current_period_end,
            }
          : { plan: "free", status: "inactive", currentPeriodEnd: null },
        usage: identity.role === "local" ? null : ownerUsage(identity.userId),
        invoices,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Billing data unavailable", error);
    return NextResponse.json(
      { error: "Billing data is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!originAllowed(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const identity = await appIdentity();
    if (identity.role !== "athlete")
      return NextResponse.json(
        { error: "Athlete account required for billing." },
        { status: 403 },
      );
    if (
      !consumeRateLimit(`billing:${identity.userId}`, 10, 60 * 60 * 1000)
        .allowed
    )
      return NextResponse.json(
        { error: "Too many billing requests." },
        { status: 429 },
      );
    if (!process.env.STRIPE_SECRET_KEY)
      return NextResponse.json(
        { error: "Stripe billing is not configured." },
        { status: 503 },
      );
    const body = await request.json();
    const origin = new URL(request.url).origin;
    if (body.action === "portal") {
      const row = database()
        .prepare(
          "SELECT stripe_customer_id FROM subscriptions WHERE owner_id=?",
        )
        .get(identity.userId) as
        { stripe_customer_id: string | null } | undefined;
      if (!row?.stripe_customer_id)
        return NextResponse.json(
          { error: "No billing customer exists yet." },
          { status: 404 },
        );
      const form = new URLSearchParams({
        customer: row.stripe_customer_id,
        return_url: new URL("/training?tab=billing", origin).toString(),
      });
      const portal = await stripeRequest("billing_portal/sessions", form);
      return NextResponse.json({ url: portal.url });
    }
    const plan = body.plan as BillablePlan;
    if (!["pro", "team"].includes(plan) || !stripePrice(plan))
      return NextResponse.json(
        { error: "Choose an available plan." },
        { status: 400 },
      );
    const form = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": stripePrice(plan),
      "line_items[0][quantity]": "1",
      success_url: new URL("/training?billing=success", origin).toString(),
      cancel_url: new URL("/training?billing=cancelled", origin).toString(),
      client_reference_id: identity.userId,
      "metadata[ownerId]": identity.userId,
      "metadata[plan]": plan,
      "subscription_data[metadata][ownerId]": identity.userId,
      "subscription_data[metadata][plan]": plan,
    });
    if (identity.email) form.set("customer_email", identity.email);
    const checkout = await stripeRequest("checkout/sessions", form);
    recordProductEvent("billing_checkout_started", identity.userId);
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Billing action failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Billing action failed.",
      },
      { status: 503 },
    );
  }
}
