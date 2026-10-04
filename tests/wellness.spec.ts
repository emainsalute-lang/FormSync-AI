import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import type { Session } from "../lib/model";
const base = "http://127.0.0.1:3001";
test("all ten wellness and session-load features persist, update, export and compare", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Wellness session " + Date.now(),
    date = "2026-10-03",
    earlier = "2026-10-02";
  const fixture = path.resolve(".tools/wellness-test.mp4");
  await promisify(execFile)(ffmpeg!, [
    "-v",
    "error",
    "-loop",
    "1",
    "-i",
    path.resolve("tests/fixtures/pose-person.jpg"),
    "-t",
    "1",
    "-r",
    "12",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=320:214",
    "-y",
    fixture,
  ]);
  // Start from legacy API data without the newly introduced wellness field.
  const leftovers: Session[] = await (
    await request.get(base + "/api/sessions")
  ).json();
  for (const s of leftovers.filter((s) =>
    s.name.startsWith("Wellness session "),
  ))
    await request.delete(base + "/api/sessions/" + s.id, {
      headers: { "If-Match": `"${s.revision || s.createdAt}"` },
    });
  const original = await (await request.get(base + "/api/workspace")).json();
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Upload a training video").setInputFiles({
    name: "wellness.mp4",
    mimeType: "video/mp4",
    buffer: await fs.readFile(fixture),
  });
  await expect(
    page.getByRole("button", { name: "Next frame", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByLabel("Drill name", { exact: true }).fill(name);
  await page.getByLabel("Practice date", { exact: true }).fill(date);
  await page.getByLabel("Makes", { exact: true }).fill("8");
  await page.getByLabel("Misses", { exact: true }).fill("2");
  await page.getByLabel("Session duration (minutes)").fill("45");
  await page.getByLabel("Session RPE (0–10)").fill("7");
  await expect(page.getByLabel("Calculated session load")).toHaveText("315 AU");
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Session duration (minutes)")).toHaveValue("45");
  await expect(page.getByLabel("Session RPE (0–10)")).toHaveValue("7");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.locator(".success-feedback")).toContainText("saved");
  const sessions: Session[] = await (
    await request.get(base + "/api/sessions")
  ).json();
  const session = sessions.find((s) => s.name === name)!;
  expect(session.durationMinutes).toBe(45);
  expect(session.sessionRpe).toBe(7);
  expect(session.sessionLoad).toBe(315);
  await page.goto(base + "/training");
  await page.getByRole("button", { name: "Wellness", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Daily wellness check-in" }),
  ).toBeVisible();
  await page.getByLabel("Check-in date").fill(date);
  await page.getByLabel("Sleep duration (hours)").fill("7.5");
  await page.getByLabel("Sleep quality", { exact: true }).selectOption("4");
  await page.getByLabel("Muscle soreness", { exact: true }).selectOption("2");
  await page.getByLabel("Stress level").selectOption("3");
  await page.getByLabel("Mood", { exact: true }).selectOption("4");
  await page.getByLabel("Bodyweight (kg)").fill("75.2");
  await page.getByLabel("Wellness notes").fill("Good recovery after practice.");
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(page.locator(".wellness-status")).toContainText(
    "Check-in saved",
  );
  await expect(
    page.getByRole("img", { name: "Sleep duration versus Success rate" }),
  ).toBeVisible();
  await expect(page.locator(".wellness-history-table")).toContainText(
    "75.2 kg",
  );
  await page.getByLabel("Training outcome").selectOption("load");
  await expect(
    page.getByRole("img", { name: "Sleep duration versus Session load" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".wellness-day-table")
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: date, exact: true }) }),
  ).toContainText("315 AU");
  await page.getByLabel("Check-in date").fill(earlier);
  await expect(page.getByLabel("Sleep duration (hours)")).toHaveValue("");
  await page.getByLabel("Bodyweight (kg)").fill("75.8");
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(page.locator(".wellness-status")).toContainText(earlier);
  await expect(
    page.getByRole("img", { name: "Bodyweight history chart" }),
  ).toBeVisible();
  await expect(
    page.locator(".wellness-history-table").getByRole("row"),
  ).toHaveCount(
    new Set([
      ...original.wellness.map((e: { date: string }) => e.date),
      date,
      earlier,
    ]).size + 1,
  );
  await page.reload();
  await page.getByRole("button", { name: "Wellness", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit wellness " + date, exact: true })
    .click();
  await expect(page.getByLabel("Sleep duration (hours)")).toHaveValue("7.5");
  await expect(page.getByLabel("Stress level")).toHaveValue("3");
  await page.getByLabel("Sleep duration (hours)").fill("8");
  await page
    .getByRole("button", { name: "Update check-in", exact: true })
    .click();
  await expect(page.locator(".wellness-status")).toContainText(
    "Check-in saved",
  );
  const saved = await (await request.get(base + "/api/workspace")).json();
  expect(
    saved.wellness.filter((e: { date: string }) => e.date === date),
  ).toHaveLength(1);
  expect(
    saved.wellness.find((e: { date: string }) => e.date === date).sleepHours,
  ).toBe(8);
  const { wellness, ...oldClient } = saved;
  expect(
    (await request.put(base + "/api/workspace", { data: oldClient })).ok(),
  ).toBeTruthy();
  const migrated = await (await request.get(base + "/api/workspace")).json();
  expect(migrated.wellness).toEqual(wellness);
  const invalid = await request.put(base + "/api/workspace", {
    data: {
      ...migrated,
      wellness: [
        ...migrated.wellness,
        { ...migrated.wellness[0], id: crypto.randomUUID() },
      ],
    },
  });
  expect(invalid.status()).toBe(400);
  const stale = await request.put(base + "/api/workspace", {
    data: { ...migrated, revision: "stale" },
  });
  expect(stale.status()).toBe(409);
  // Refresh after the external legacy-client write to pick up its new revision.
  await page
    .getByRole("button", { name: "Refresh training data", exact: true })
    .click();
  await page.getByRole("button", { name: "Wellness", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export wellness CSV", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("formsync-wellness.csv");
  await fs.mkdir(".tools/screenshots", { recursive: true });
  await page.screenshot({
    path: ".tools/screenshots/wellness-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: ".tools/screenshots/wellness-mobile.png",
    fullPage: true,
  });
  page.once("dialog", (d) => void d.dismiss());
  await page
    .getByRole("button", { name: "Delete wellness " + earlier, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit wellness " + earlier, exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", { name: "Delete wellness " + earlier, exact: true })
    .click();
  await expect(page.locator(".wellness-status")).toContainText(
    "Check-in deleted for " + earlier,
  );
  await expect(
    page.getByRole("button", { name: "Edit wellness " + earlier, exact: true }),
  ).not.toBeVisible();
  await page.goto(base + "/report");
  await expect(
    page.getByRole("heading", { name: "Wellness & bodyweight history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "75.2 kg", exact: true }),
  ).toBeVisible();
  const latest = await (await request.get(base + "/api/workspace")).json();
  expect(
    (
      await request.put(base + "/api/workspace", {
        data: { ...latest, wellness: original.wellness },
      })
    ).ok(),
  ).toBeTruthy();
  const cleared = await request.put(base + "/api/sessions/" + session.id, {
    multipart: {
      session: JSON.stringify({
        ...session,
        sessionLoad: 999,
        durationMinutes: null,
        sessionRpe: null,
      }),
    },
  });
  expect(cleared.status()).toBe(200);
  const updated = await cleared.json();
  expect(updated.sessionLoad).toBeNull();
  expect(updated.durationMinutes).toBeNull();
  expect(
    (
      await request.delete(base + "/api/sessions/" + session.id, {
        headers: { "If-Match": `"${updated.revision}"` },
      })
    ).status(),
  ).toBe(204);
  expect(errors).toEqual([]);
});
