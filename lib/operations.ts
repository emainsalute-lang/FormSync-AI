import "server-only";
import { randomUUID } from "node:crypto";
import { database } from "./database";

export function recordOperationalEvent(
  category: string,
  severity: "info" | "warning" | "error",
  message: string,
  context: Record<string, unknown> = {},
) {
  try {
    database()
      .prepare(
        "INSERT INTO operational_events(id,category,severity,message,context,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        category.slice(0, 80),
        severity,
        message.slice(0, 500),
        JSON.stringify(context).slice(0, 4000),
        new Date().toISOString(),
      );
    if (Math.random() < 0.01)
      database()
        .prepare("DELETE FROM operational_events WHERE created_at<?")
        .run(new Date(Date.now() - 90 * 86400000).toISOString());
  } catch (error) {
    console.error("Operational event could not be recorded", error);
    return;
  }
  const webhook = process.env.FORMSYNC_ALERT_WEBHOOK;
  if (severity === "error" && webhook) {
    void fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, severity, message, context }),
      signal: AbortSignal.timeout(5000),
    })
      .then((response) => {
        if (!response.ok)
          console.error("Operational alert delivery failed", response.status);
      })
      .catch((error) =>
        console.error("Operational alert delivery failed", error),
      );
  }
}

const productEvents = new Set([
  "session_created",
  "session_updated",
  "upload_started",
  "movement_analysis_saved",
  "workout_completed",
  "share_link_created",
  "billing_checkout_started",
]);
export function recordProductEvent(event: string, ownerId: string) {
  if (!productEvents.has(event))
    throw new Error("Unknown product analytics event.");
  const day = new Date().toISOString().slice(0, 10);
  try {
    database()
      .prepare(
        `INSERT INTO product_analytics(day,event,owner_id,count) VALUES(?,?,?,1)
         ON CONFLICT(day,event,owner_id) DO UPDATE SET count=count+1`,
      )
      .run(day, event, ownerId);
  } catch (error) {
    console.error(
      "Product analytics event could not be recorded",
      event,
      error,
    );
  }
}
