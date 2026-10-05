import { test, expect } from "@playwright/test";
test("video upload, drawing, saved history and range streaming work end to end", async ({
  page,
  request,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await page.goto("http://127.0.0.1:3001");
  await expect(
    page.getByRole("heading", { name: "Every rep. A little better." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeEnabled();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    return await new Promise<number[]>((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(
          Array.from(
            new Uint8Array(
              await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
            ),
          ),
        );
      };
      let frame = 0;
      const timer = setInterval(() => {
        ctx.fillStyle = "#1f2924";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#b7f76b";
        ctx.fillRect(90 + frame++, 90, 80, 180);
      }, 33);
      recorder.start();
      setTimeout(() => {
        clearInterval(timer);
        recorder.stop();
      }, 1700);
    });
  });
  await page.getByLabel("Upload a training video").setInputFiles({
    name: "practice.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByRole("button", { name: "Play video", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(".video-plane video")).toHaveAttribute(
    "src",
    /\/api\/videos\/.*\?optimized=1$/,
  );
  expect(
    await page
      .locator(".video-plane video")
      .evaluate((element) => (element as HTMLVideoElement).videoWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "0.25x", exact: true }).click();
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause video", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  await page.getByLabel("Video timeline").fill("0");
  await page.getByLabel("Video timeline").dispatchEvent("input");
  await expect(
    page.getByRole("button", { name: "Next frame", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(page.locator(".decoded-frame")).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v) => (v as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Angle", exact: true }).click();
  const box = await page.locator("canvas").boundingBox();
  expect(box).not.toBeNull();
  for (const p of [
    { x: 0.3, y: 0.3 },
    { x: 0.3, y: 0.6 },
    { x: 0.6, y: 0.6 },
  ])
    await page.mouse.click(
      box!.x + box!.width * p.x,
      box!.y + box!.height * p.y,
    );
  await expect(page.getByText("90.0°", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear all annotations" }).click();
  await expect(page.getByText("90.0°", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Undo annotation" }).click();
  await expect(page.getByText("90.0°", { exact: true })).toBeVisible();
  const name = "QA jump shot " + Date.now();
  await page.getByLabel("Drill name", { exact: true }).fill(name);
  await page.getByLabel("Makes", { exact: true }).fill("7");
  await page.getByLabel("Misses", { exact: true }).fill("3");
  await page.getByLabel("Reps completed", { exact: true }).fill("20");
  await page.getByLabel("Target reps", { exact: true }).fill("50");
  await page
    .getByLabel("Personal notes", { exact: true })
    .fill("Keep the release consistent.");
  await expect(
    page.locator(".metrics-panel").getByText("70%", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.locator(".success-feedback")).toContainText(
    "Session saved",
    {
      timeout: 20000,
    },
  );
  const response = await request.get("http://127.0.0.1:3001/api/sessions");
  expect(response.status()).toBe(200);
  const sessions = await response.json();
  const session = sessions.find((s: { name: string }) => s.name === name);
  expect(session.drawings).toHaveLength(1);
  expect(session.drawings[0].points).toHaveLength(3);
  const video = await request.get(
    "http://127.0.0.1:3001/api/videos/" + session.videoId,
    { headers: { Range: "bytes=0-15" } },
  );
  expect(video.status()).toBe(206);
  expect((await video.body()).length).toBe(16);
  const invalidRange = await request.get(
    "http://127.0.0.1:3001/api/videos/" + session.videoId,
    { headers: { Range: "bytes=999999999-" } },
  );
  expect(invalidRange.status()).toBe(416);
  const rejected = await request.post("http://127.0.0.1:3001/api/sessions", {
    multipart: {
      session: JSON.stringify({
        ...session,
        reps: -1,
        videoId: session.videoId,
      }),
    },
  });
  expect(rejected.status()).toBe(400);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open " + name }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open " + name }).click();
  await expect(page.getByLabel("Drill name")).toHaveValue(name);
  await expect(
    page.getByRole("button", { name: "Play video", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Video timeline")
    .fill(String(Math.round(session.drawings[0].time * 1000) / 1000));
  await page.getByLabel("Video timeline").dispatchEvent("input");
  await expect(page.getByText("90.0°", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".tools/screenshots/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".tools/screenshots/mobile.png",
    fullPage: true,
  });
  await page.getByLabel("Search practice history").fill("no-match-123");
  await expect(page.getByText("No matching sessions")).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
