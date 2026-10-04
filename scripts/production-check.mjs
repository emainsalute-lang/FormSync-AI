import path from "node:path";
import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const errors = [];
const warnings = [];
const checkPair = (names, label) => {
  const present = names.filter((name) => Boolean(process.env[name]));
  if (present.length && present.length !== names.length)
    errors.push(
      `${label} configuration is incomplete; set ${names.join(", ")} together.`,
    );
};
checkPair(
  ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  "Supabase Auth",
);
checkPair(
  [
    "FORMSYNC_VAPID_PUBLIC_KEY",
    "FORMSYNC_VAPID_PRIVATE_KEY",
    "FORMSYNC_VAPID_SUBJECT",
  ],
  "Web Push",
);
checkPair(
  [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "FORMSYNC_STRIPE_PRICE_PRO",
    "FORMSYNC_STRIPE_PRICE_TEAM",
  ],
  "Stripe billing",
);

if (process.env.NODE_ENV === "production") {
  if (!process.env.FORMSYNC_ADMIN_TOKEN)
    errors.push(
      "Set FORMSYNC_ADMIN_TOKEN to protect operations support tooling.",
    );
  if (!process.env.FORMSYNC_BACKUP_DIR)
    warnings.push(
      "FORMSYNC_BACKUP_DIR is unset; scheduled backups are stored under the application data directory.",
    );
  if (!process.env.FORMSYNC_ALERT_WEBHOOK)
    warnings.push(
      "FORMSYNC_ALERT_WEBHOOK is unset; error alerts are retained locally only.",
    );
}
if (process.env.FORMSYNC_ALERT_WEBHOOK) {
  try {
    const url = new URL(process.env.FORMSYNC_ALERT_WEBHOOK);
    if (url.protocol !== "https:")
      errors.push("FORMSYNC_ALERT_WEBHOOK must use HTTPS.");
  } catch {
    errors.push("FORMSYNC_ALERT_WEBHOOK must be a valid HTTPS URL.");
  }
}
if (process.env.FORMSYNC_BACKUP_DIR) {
  const data = path.resolve(
    process.env.FORMSYNC_DATA_DIR || path.join(process.cwd(), "data"),
  );
  const backup = path.resolve(process.env.FORMSYNC_BACKUP_DIR);
  const relative = path.relative(data, backup);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    warnings.push(
      "Backup directory is inside the application data directory; it will not protect against loss of that volume.",
    );
  try {
    await mkdir(backup, { recursive: true });
    const probe = path.join(backup, `.formsync-check-${randomUUID()}`);
    await writeFile(probe, "ok", { flag: "wx" });
    await access(probe);
    await unlink(probe);
  } catch (error) {
    errors.push(
      `Backup directory is not writable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
if (process.env.FORMSYNC_HEALTH_URL) {
  try {
    const start = performance.now();
    const response = await fetch(process.env.FORMSYNC_HEALTH_URL, {
      headers: process.env.FORMSYNC_HEALTH_TOKEN
        ? { Authorization: `Bearer ${process.env.FORMSYNC_HEALTH_TOKEN}` }
        : {},
      signal: AbortSignal.timeout(5000),
    });
    const elapsed = Math.round(performance.now() - start);
    if (!response.ok)
      errors.push(`Health endpoint returned HTTP ${response.status}.`);
    if (elapsed > 3000)
      warnings.push(`Health endpoint took ${elapsed}ms (target <= 3000ms).`);
    else console.log(`Health endpoint responded in ${elapsed}ms.`);
  } catch (error) {
    errors.push(
      `Health endpoint check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exitCode = 1;
else console.log("Production configuration checks passed.");
