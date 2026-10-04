import "server-only";
import webpush from "web-push";
import { database, transaction } from "./database";
import { recordOperationalEvent } from "./operations";

export function pushConfiguration() {
  const publicKey = process.env.FORMSYNC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.FORMSYNC_VAPID_PRIVATE_KEY;
  const subject = process.env.FORMSYNC_VAPID_SUBJECT;
  if (publicKey && privateKey && subject) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey, configured: true };
  }
  return { publicKey: "", configured: false };
}

export async function sendDueReminders(now = new Date()) {
  if (!pushConfiguration().configured) return;
  const db = database();
  const reminders = db
    .prepare(
      "SELECT owner_id,hour,minute,timezone,last_sent_date FROM push_reminders WHERE enabled=1",
    )
    .all() as {
    owner_id: string;
    hour: number;
    minute: number;
    timezone: string;
    last_sent_date: string | null;
  }[];
  for (const reminder of reminders) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: reminder.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now);
      const part = (name: string) =>
        parts.find((item) => item.type === name)?.value || "";
      const day = `${part("year")}-${part("month")}-${part("day")}`;
      if (
        Number(part("hour")) !== reminder.hour ||
        Number(part("minute")) !== reminder.minute ||
        reminder.last_sent_date === day
      )
        continue;
      const claimed = transaction(
        () =>
          db
            .prepare(
              "UPDATE push_reminders SET last_sent_date=? WHERE owner_id=? AND enabled=1 AND (last_sent_date IS NULL OR last_sent_date<>?)",
            )
            .run(day, reminder.owner_id, day).changes > 0,
      );
      if (!claimed) continue;
      const subs = db
        .prepare(
          "SELECT endpoint_hash,endpoint,p256dh,auth FROM push_subscriptions WHERE owner_id=?",
        )
        .all(reminder.owner_id) as {
        endpoint_hash: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }[];
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify({
                title: "Time to train",
                body: "Your FormSync practice reminder is here.",
                url: "/training",
              }),
            );
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              db.prepare(
                "DELETE FROM push_subscriptions WHERE endpoint_hash=?",
              ).run(sub.endpoint_hash);
              return;
            }
            recordOperationalEvent(
              "push-reminder",
              "error",
              "Push delivery failed",
              {
                ownerId: reminder.owner_id,
                status: status || 0,
              },
            );
          }
        }),
      );
    } catch (error) {
      recordOperationalEvent(
        "push-reminder",
        "error",
        error instanceof Error ? error.message : "Reminder scheduling failed",
        { ownerId: reminder.owner_id },
      );
    }
  }
}
