import { test, expect } from "@playwright/test";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["camera"],
});
test("camera recording produces an indexed clip without leaking camera access", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3001");
  await expect(
    page.getByRole("button", { name: "Record with camera", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Record with camera", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Frame your movement")).toBeVisible();
  await expect(page.getByText(/Turn your phone sideways/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use front camera", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.getByText(/Camera recording · 2s/)).toBeVisible({
    timeout: 10000,
  });
  await page
    .getByRole("button", { name: "Stop and use video", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Next frame", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(".camera-preview")).toHaveCount(0);
  await expect(page.locator(".media-status")).toContainText("FPS detected");
  expect(errors).toEqual([]);
});
