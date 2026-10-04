import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
test("storage dashboard exposes usage, background assets, recovery snapshots and branded icons", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const base = "http://127.0.0.1:3001";
  const first = await request.get(base + "/api/storage");
  expect(first.status()).toBe(200);
  const state = await first.json();
  expect(state.database).toBe("SQLite");
  expect(state.canManage).toBe(true);
  expect(state.usage.usedBytes).toBeGreaterThanOrEqual(0);
  const hostile = await request.post(base + "/api/storage", {
    headers: { Origin: "https://untrusted.example" },
    data: { action: "backup" },
  });
  expect(hostile.status()).toBe(403);
  const invalid = await request.post(base + "/api/storage", {
    data: { action: "policy", policy: { ...state.policy, quotaBytes: 1 } },
  });
  expect(invalid.status()).toBe(400);
  await page.goto(base + "/storage");
  await expect(
    page.getByRole("heading", { name: "Storage & recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Storage quota usage" }),
  ).toBeVisible();
  const logo = page.locator('img[src="/brand/logo-white.png"]');
  await expect(logo).toBeVisible();
  expect(
    await logo.evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    ),
  ).toBe(true);
  const started = Date.now();
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByRole("status")).toContainText("Backup queued");
  await expect
    .poll(
      async () => {
        const response = await request.get(base + "/api/storage");
        const data = await response.json();
        return data.backups.some(
          (b: { createdAt: string }) => Date.parse(b.createdAt) >= started,
        );
      },
      { timeout: 90000 },
    )
    .toBe(true);
  const recovery = await request.get(base + "/api/storage/recovery");
  expect(await recovery.text()).toContain("npm run restore:cloud");
  const manifest = await (
    await request.get(base + "/manifest.webmanifest")
  ).json();
  expect(
    manifest.icons.some(
      (i: { src: string }) => i.src === "/brand/icon-maskable-512.png",
    ),
  ).toBe(true);
  const favicon = await request.get(base + "/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect((await favicon.body()).readUInt16LE(2)).toBe(1);
  const withVideo = state.videos[0];
  if (withVideo) {
    await expect
      .poll(
        async () =>
          (
            await request.get(`${base}/api/videos/${withVideo.id}/thumbnail`)
          ).status(),
        { timeout: 60000 },
      )
      .toBe(200);
    await expect
      .poll(
        async () =>
          (
            await request.get(`${base}/api/videos/${withVideo.id}/optimized`, {
              headers: { Range: "bytes=0-31" },
            })
          ).status(),
        { timeout: 60000 },
      )
      .toBe(206);
  }
  await fs.mkdir(".tools/screenshots", { recursive: true });
  await page.screenshot({
    path: ".tools/screenshots/storage-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".tools/screenshots/storage-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
