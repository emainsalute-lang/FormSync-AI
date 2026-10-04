import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { database, transaction } from "./database";

export type BillablePlan = "pro" | "team";
export function stripePrice(plan: BillablePlan) {
  return (
    process.env[
      plan === "pro"
        ? "FORMSYNC_STRIPE_PRICE_PRO"
        : "FORMSYNC_STRIPE_PRICE_TEAM"
    ] || ""
  );
}
export function stripeConfigured() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    stripePrice("pro") &&
    stripePrice("team") &&
    process.env.STRIPE_WEBHOOK_SECRET,
  );
}
export async function stripeRequest(
  endpoint: string,
  params?: URLSearchParams,
) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe billing is not configured.");
  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(params
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: params,
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Stripe request failed.",
    );
  return data;
}
export function validStripeSignature(raw: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const fields = signature.split(",").map((field) => field.split("=", 2));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields
    .filter(([key]) => key === "v1")
    .map(([, value]) => value)
    .filter((value): value is string => Boolean(value));
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest();
  return signatures.some((value) => {
    if (!/^[a-f0-9]{64}$/i.test(value)) return false;
    const actual = Buffer.from(value, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
}
export function saveStripeEvent(event: {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}) {
  const object = event.data.object;
  transaction(() => {
    if (
      database()
        .prepare("SELECT event_id FROM stripe_events WHERE event_id=?")
        .get(event.id)
    )
      return;
    if (event.type === "checkout.session.completed") {
      const owner = object.metadata as Record<string, string> | undefined;
      if (!owner?.ownerId || !["pro", "team"].includes(owner.plan))
        throw new Error("Checkout metadata is incomplete.");
      database()
        .prepare(
          `INSERT INTO subscriptions(owner_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,updated_at)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,plan=excluded.plan,status=excluded.status,updated_at=excluded.updated_at`,
        )
        .run(
          owner.ownerId,
          String(object.customer || ""),
          String(object.subscription || ""),
          owner.plan,
          "pending",
          null,
          new Date().toISOString(),
        );
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const metadata = object.metadata as Record<string, string> | undefined;
      const ownerId = metadata?.ownerId;
      const plan = metadata?.plan;
      if (ownerId && (plan === "pro" || plan === "team")) {
        const prices =
          (object.items as { data?: { price?: { id?: string } }[] } | undefined)
            ?.data || [];
        const price = prices[0]?.price?.id;
        const expectedPlan =
          price === stripePrice("pro")
            ? "pro"
            : price === stripePrice("team")
              ? "team"
              : plan;
        const period = object.current_period_end;
        database()
          .prepare(
            `INSERT INTO subscriptions(owner_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,updated_at)
             VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,plan=excluded.plan,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=excluded.updated_at`,
          )
          .run(
            ownerId,
            String(object.customer || ""),
            String(object.id || ""),
            expectedPlan,
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : String(object.status || "inactive"),
            typeof period === "number"
              ? new Date(period * 1000).toISOString()
              : null,
            new Date().toISOString(),
          );
      }
    } else if (event.type === "invoice.payment_failed") {
      database()
        .prepare(
          "UPDATE subscriptions SET status='past_due',updated_at=? WHERE stripe_customer_id=?",
        )
        .run(new Date().toISOString(), String(object.customer || ""));
    }
    database()
      .prepare("INSERT INTO stripe_events(event_id,created_at) VALUES(?,?)")
      .run(event.id, new Date().toISOString());
  });
}
