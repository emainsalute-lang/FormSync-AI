import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";
import type { Session } from "../lib/model";
import { localDate } from "../lib/model";
const base = "http://127.0.0.1:3001";
test("training hub persists goals, plans, comments, real pose analysis and reports", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const name = "Training test " + Date.now();
  const customDrillName = name + " custom drill";
  const workoutName = name + " workout";
  const source = path.resolve(".tools/person-test.mp4");
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
    "scale=640:426",
    "-y",
    source,
  ]);
  const mr = await request.post(base + "/api/media", {
    multipart: {
      video: {
        name: "athlete.mp4",
        mimeType: "video/mp4",
        buffer: await fs.readFile(source),
      },
    },
  });
  expect(mr.ok()).toBeTruthy();
  const media = await mr.json();
  const body = {
    name,
    date: localDate(),
    makes: 8,
    misses: 2,
    reps: 40,
    target: 50,
    notes: "Real athlete pose fixture",
    tags: ["Shooting"],
    fps: media.fps,
    drawings: [
      {
        id: crypto.randomUUID(),
        tool: "line",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.1 },
        ],
        time: 0,
        color: "#b7f76b",
      },
    ],
    videoId: media.id,
  };
  const sr = await request.post(base + "/api/sessions", {
    multipart: { session: JSON.stringify(body) },
  });
  expect(sr.status()).toBe(201);
  const session: Session = await sr.json();
  const ex = await request.post(base + `/api/sessions/${session.id}/export`, {
    headers: { "If-Match": `"${session.revision}"` },
  });
  expect(ex.status()).toBe(200);
  const exported = path.resolve(".tools/annotated-test.mp4");
  await fs.writeFile(exported, await ex.body());
  const frame = await promisify(execFile)(
    ffmpeg!,
    [
      "-v",
      "error",
      "-i",
      exported,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
  );
  const pixel = await sharp(frame.stdout)
    .extract({ left: 128, top: 42, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(pixel[1]).toBeGreaterThan(180);
  expect(pixel[2]).toBeLessThan(180);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/training");
  await expect(
    page.getByRole("heading", { name: "Daily training trend" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Plans & goals", exact: true })
    .click();
  await page.getByLabel("Goal name", { exact: true }).fill(name);
  await page.getByLabel("Goal target", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: name + " progress" }),
  ).toHaveAttribute("value", "100");
  await page.getByLabel("Planned drill", { exact: true }).fill(name + " plan");
  await page
    .getByRole("button", { name: "Schedule drill", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Complete " + name + " plan", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete " + name + " plan",
      exact: true,
    }),
  ).toBeChecked();
  await page.reload();
  await page
    .getByRole("button", { name: "Plans & goals", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete " + name + " plan",
      exact: true,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await page.getByLabel("Saved session").selectOption(session.id);
  await page.getByLabel("Review comment").fill("Keep the camera fixed.");
  await page
    .getByRole("button", { name: "Add review comment", exact: true })
    .click();
  await expect(
    page.locator(".review-text").filter({ hasText: "Keep the camera fixed." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByLabel("Left clip").selectOption(session.id);
  await page.getByLabel("Right clip").selectOption(session.id);
  await expect(
    page.getByRole("button", { name: "Play comparison", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Right offset (seconds)").fill("0.1");
  await page
    .getByRole("button", { name: "Play comparison", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".compare-grid video")
        .first()
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.15);
  await page
    .getByRole("button", { name: "Pause comparison", exact: true })
    .click();
  const times = await page
    .locator(".compare-grid video")
    .evaluateAll((vs: HTMLVideoElement[]) => vs.map((v) => v.currentTime));
  expect(Math.abs(times[1] - times[0] - 0.1)).toBeLessThan(0.12);
  await page.getByRole("button", { name: "Movement", exact: true }).click();
  await page.getByLabel("Saved session").selectOption(session.id);
  await expect(
    page.getByRole("button", { name: "Analyze movement", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Analyze movement", exact: true })
    .click();
  await expect(page.locator(".pose-status")).toContainText("Results saved.", {
    timeout: 90000,
  });
  await expect(page.locator(".pose-status")).toContainText("Detected a person");
  await expect(page.locator(".pose-confidence")).toContainText(
    "Frame confidence",
  );
  await expect(
    page.getByRole("region", { name: "Camera visibility checks" }),
  ).toBeVisible();
  await expect(
    page.getByText("Estimated squat repetitions", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Angular velocity", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Correct joint on frame", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Mark release at playhead", exact: true })
    .click();
  await expect(page.locator(".pose-status")).toContainText("release marked");
  const poseCanvas = page.locator(".pose-stage canvas");
  const correctionToggle = page.getByRole("button", {
    name: "Correct joint on frame",
    exact: true,
  });
  await correctionToggle.click();
  await expect(
    page.getByRole("button", {
      name: "Finish joint correction",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  const canvasBounds = await poseCanvas.boundingBox();
  await poseCanvas.click({
    position: {
      x: canvasBounds!.width / 2,
      y: canvasBounds!.height / 2,
    },
  });
  await expect(page.locator(".pose-status")).toContainText("corrected at");
  await page
    .getByRole("button", { name: "Finish joint correction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save analysis", exact: true })
    .click();
  await expect(page.locator(".pose-status")).toContainText("Analysis saved.");
  const saved = await (await request.get(base + "/api/workspace")).json();
  const analysis = saved.analyses.find(
    (a: { sessionId: string }) => a.sessionId === session.id,
  );
  expect(analysis.samples.length).toBeGreaterThan(0);
  expect(analysis.samples[0].landmarks).toHaveLength(33);
  expect(
    analysis.phases.some(
      (phase: { phase: string }) => phase.phase === "release",
    ),
  ).toBeTruthy();
  expect(
    analysis.samples.some(
      (sample: { landmarks: { x: number; y: number; visibility: number }[] }) =>
        sample.landmarks[25].x > 0.45 &&
        sample.landmarks[25].x < 0.55 &&
        sample.landmarks[25].y > 0.45 &&
        sample.landmarks[25].y < 0.55 &&
        sample.landmarks[25].visibility === 1,
    ),
  ).toBeTruthy();
  await page.getByLabel("Sport analysis template").selectOption("custom");
  await page.getByLabel("Custom template name").fill("Serve phases");
  await page
    .getByRole("button", { name: "Save custom template", exact: true })
    .click();
  await expect(page.locator(".pose-status")).toContainText(
    "Custom analysis template saved.",
  );
  const templates = await (await request.get(base + "/api/workspace")).json();
  expect(
    templates.analysisTemplates.some(
      (template: { name: string }) => template.name === "Serve phases",
    ),
  ).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Movement", exact: true }).click();
  await page.getByLabel("Saved session").selectOption(session.id);
  await expect(
    page.getByRole("button", { name: "Save analysis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Right elbow angle over time" }),
  ).toBeVisible();
  await expect(page.locator(".pose-visibility")).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByLabel("Left clip").selectOption(session.id);
  await page.getByLabel("Right clip").selectOption(session.id);
  await page
    .getByRole("combobox", { name: "Joint to compare", exact: true })
    .selectOption("Right elbow");
  await expect(
    page.getByRole("img", { name: "Right elbow comparison timeline" }),
  ).toBeVisible();
  await page.getByLabel("Transparent video overlay").check();
  await expect(page.getByLabel("Reference opacity")).toBeVisible();
  await page.getByRole("button", { name: "Storage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Storage usage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Storage quota usage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Quota and retention" }),
  ).toBeVisible();
  const storage = await (await request.get(base + "/api/storage")).json();
  expect(
    storage.videos.some(
      (video: { sessionId: string }) => video.sessionId === session.id,
    ),
  ).toBeTruthy();
  const savedPolicy = {
    quotaBytes: storage.policy.quotaBytes,
    retentionDays: storage.policy.retentionDays,
  };
  const invalidPolicy = await request.put(base + "/api/storage", {
    data: { quotaBytes: 1, retentionDays: -1 },
  });
  expect(invalidPolicy.status()).toBe(400);
  const policy = await request.put(base + "/api/storage", {
    data: savedPolicy,
  });
  expect(policy.ok()).toBeTruthy();
  await page
    .getByRole("button", { name: "Save storage settings", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Storage settings saved." }),
  ).toBeVisible();
  await fs.mkdir(".tools/screenshots", { recursive: true });
  await page.screenshot({
    path: ".tools/screenshots/training-movement-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: ".tools/screenshots/training-movement-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Drill name").fill(customDrillName);
  await page
    .getByLabel("Drill instructions")
    .fill("Repeat the movement with a consistent setup.");
  await page
    .getByLabel("Demonstration clip (optional)")
    .selectOption(session.id);
  await page
    .getByRole("button", { name: "Save custom drill", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: customDrillName, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Workout name").fill(workoutName);
  await page
    .getByRole("combobox", { name: "Drill", exact: true })
    .selectOption("builtin-form-shooting");
  await page
    .getByRole("button", { name: "Add drill to workout", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save workout template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: workoutName, exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Workout", exact: true })
    .selectOption({ label: workoutName });
  await page
    .getByRole("button", { name: "Schedule workout", exact: true })
    .click();
  await expect(
    page.getByText(`${localDate()} · Planned`, { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start workout", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Complete set", exact: true }).click();
  await page
    .getByRole("button", { name: "Save workout log", exact: true })
    .click();
  await expect(
    page.getByText("Workout log saved with effort and fatigue ratings.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/effort 5\/10 · fatigue 3\/5/).last(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Profile & reports", exact: true })
    .click();
  await page.getByLabel("Athlete name").fill("Test athlete");
  await page.getByLabel("Primary sport").selectOption("Basketball");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Basketball review guidance" }),
  ).toBeVisible();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export sessions CSV", exact: true })
    .click();
  expect((await dl).suggestedFilename()).toBe("formsync-sessions.csv");
  await page.goto(base + "/report");
  await expect(
    page.getByRole("heading", { name: "FormSync AI progress report" }),
  ).toBeVisible();
  await expect(
    page.getByText("Test athlete · Basketball", { exact: false }),
  ).toBeVisible();
  expect((await request.get(base + "/api/health")).ok()).toBeTruthy();
  await page.goto(base + "/training");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Daily training trend" }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator(".offline-banner")).toContainText(
    "Offline snapshot",
  );
  await expect(
    page.getByRole("heading", { name: "Daily training trend" }),
  ).toBeVisible();
  await page.context().setOffline(false);
  const current = await (await request.get(base + "/api/workspace")).json();
  const stale = await request.put(base + "/api/workspace", {
    data: { ...current, revision: "old" },
  });
  expect(stale.status()).toBe(409);
  const invalid = await request.put(base + "/api/workspace", {
    data: {
      ...current,
      plans: [
        {
          id: session.id,
          name: "Invalid",
          date: "2026-02-30",
          target: 1,
          tag: "Shooting",
          done: false,
        },
      ],
    },
  });
  expect(invalid.status()).toBe(400);
  const cleaned = {
    ...current,
    goals: current.goals.filter((g: { name: string }) => g.name !== name),
    plans: current.plans.filter(
      (p: { name: string }) => p.name !== name + " plan",
    ),
    comments: current.comments.filter(
      (c: { sessionId: string }) => c.sessionId !== session.id,
    ),
    analyses: current.analyses.filter(
      (a: { sessionId: string }) => a.sessionId !== session.id,
    ),
  };
  expect(
    (await request.put(base + "/api/workspace", { data: cleaned })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.delete(base + "/api/sessions/" + session.id, {
        headers: { "If-Match": '"' + session.revision + '"' },
      })
    ).status(),
  ).toBe(204);
  expect(errors).toEqual([]);
});
