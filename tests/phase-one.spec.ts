import { test, expect, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
async function fixture(page: Page) {
  return Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext("2d")!;
      const stream = c.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      return new Promise<number[]>((resolve) => {
        let frame = 0;
        const interval = setInterval(() => {
          ctx.fillStyle = "#243027";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "#b7f76b";
          ctx.fillRect(20 + frame++ * 3, 40, 40, 80);
        }, 33);
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          clearInterval(interval);
          stream.getTracks().forEach((t) => t.stop());
          resolve(
            Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
          );
        };
        recorder.start();
        setTimeout(() => recorder.stop(), 1800);
      });
    }),
  );
}
test("all ten Phase 1 features work together", async ({ page, request }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3001");
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeEnabled();
  const name = "Phase 1 drill " + Date.now();
  await page.getByLabel("Upload a training video").setInputFiles({
    name: "phase-one.webm",
    mimeType: "video/webm",
    buffer: await fixture(page),
  });
  await expect(
    page.getByRole("button", { name: "Next frame", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(".media-status")).toContainText("FPS detected");
  await page.getByLabel("Drill name", { exact: true }).fill(name);
  await page.getByLabel("Personal notes").fill("Draft survives reload.");
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Drill name")).toHaveValue(name);
  await expect(page.getByLabel("Personal notes")).toHaveValue(
    "Draft survives reload.",
  );
  await expect(page.locator(".success-feedback")).toContainText(
    "draft has been restored",
  );
  await expect(
    page.getByRole("button", { name: "Next frame", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const stage = page.getByLabel(
    "Video review. Space to play or pause. Arrow keys to step decoded frames.",
  );
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".decoded-frame")).toBeVisible();
  const first = await page.locator(".decoded-frame").getAttribute("src");
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => page.locator(".decoded-frame").getAttribute("src"))
    .not.toBe(first);
  await page.getByRole("button", { name: "Rotate video clockwise" }).click();
  await expect(page.locator(".video-plane")).toHaveCSS(
    "transform",
    /matrix\(0, 1, -1, 0,/,
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByLabel("Zoom level")).toHaveText("125%");
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  const box = await stage.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 20,
    box!.y + box!.height / 2 + 15,
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(page.getByLabel("Zoom level")).toHaveText("100%");
  await page.getByLabel("Video timeline").fill("0.5");
  await page.getByRole("button", { name: "Angle", exact: true }).click();
  await stage.scrollIntoViewIfNeeded();
  const viewport = await page.locator("canvas").boundingBox();
  for (const p of [
    { x: 0.3, y: 0.3 },
    { x: 0.3, y: 0.6 },
    { x: 0.6, y: 0.6 },
  ])
    await page.mouse.click(
      viewport!.x + viewport!.width * p.x,
      viewport!.y + viewport!.height * p.y,
    );
  await expect(
    page.locator(".metrics-panel").getByText("90.0\u00b0", { exact: true }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export frame", exact: true }).click();
  const download = await downloadEvent;
  const png = await fs.readFile((await download.path())!);
  expect(png.readUInt32BE(16)).toBe(360);
  expect(png.readUInt32BE(20)).toBe(640);
  await page.getByLabel("Trim start").fill("0.2");
  await page.getByLabel("Trim end").fill("1.2");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.locator(".success-feedback")).toContainText(
    "Session saved",
    { timeout: 30000 },
  );
  let saved = (
    await (await request.get("http://127.0.0.1:3001/api/sessions")).json()
  ).find((s: { name: string }) => s.name === name);
  expect(saved.rotation).toBe(0);
  expect(saved.drawings).toHaveLength(1);
  expect(saved.drawings[0].time).toBeCloseTo(0.3, 1);
  expect(saved.videoType).toBe("video/mp4");
  const meta = await (
    await request.get(
      `http://127.0.0.1:3001/api/videos/${saved.videoId}/metadata`,
    )
  ).json();
  expect(meta.frames).toContain(saved.drawings[0].time);
  expect(meta.width).toBe(360);
  expect(meta.height).toBe(640);
  expect(meta.duration).toBeGreaterThan(0.9);
  expect(meta.duration).toBeLessThan(1.15);
  const count = (
    await (await request.get("http://127.0.0.1:3001/api/sessions")).json()
  ).length;
  await expect(
    page.getByRole("button", { name: "Update session", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByLabel("Personal notes").fill("Updated in place.");
  await page
    .getByRole("button", { name: "Update session", exact: true })
    .click();
  await expect(page.locator(".success-feedback")).toContainText(
    "Session updated",
  );
  const records = await (
    await request.get("http://127.0.0.1:3001/api/sessions")
  ).json();
  expect(records).toHaveLength(count);
  const updated = records.find((s: { id: string }) => s.id === saved.id);
  expect(updated.notes).toBe("Updated in place.");
  expect(updated.revision).not.toBe(saved.revision);
  const stale = new FormData();
  stale.set(
    "session",
    JSON.stringify({ ...saved, trimStart: 0, trimEnd: null }),
  );
  const staleResult = await request.put(
    `http://127.0.0.1:3001/api/sessions/${saved.id}`,
    {
      multipart: {
        session: JSON.stringify({ ...saved, trimStart: 0, trimEnd: null }),
      },
    },
  );
  expect(staleResult.status()).toBe(409);
  await page.screenshot({
    path: ".tools/screenshots/phase-one-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".tools/screenshots/phase-one-mobile.png",
    fullPage: true,
  });
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page
    .getByRole("button", { name: "Delete " + name, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open " + name, exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Delete " + name, exact: true })
    .click();
  await expect(page.locator(".success-feedback")).toContainText(
    "Session deleted",
  );
  await expect(
    page.getByRole("button", { name: "Open " + name, exact: true }),
  ).not.toBeVisible();
  expect(
    (
      await request.get(`http://127.0.0.1:3001/api/videos/${saved.videoId}`)
    ).status(),
  ).toBe(404);
  expect(errors).toEqual([]);
});
