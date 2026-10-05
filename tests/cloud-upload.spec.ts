import { test, expect } from "@playwright/test";

test("failed cloud preparation cannot submit a raw video to session saving", async ({
  page,
}) => {
  let saved = false;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") saved = true;
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/uploads", async (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Supabase storage is not configured." },
    }),
  );
  await page.goto("http://127.0.0.1:3001");
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Drill name", { exact: true }).fill("Failed upload");
  await page.getByLabel("Upload a training video").setInputFiles({
    name: "failed.webm",
    mimeType: "video/webm",
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  });
  await expect(
    page.getByRole("region", { name: "Video analyzer" }).getByRole("alert"),
  ).toContainText("Supabase storage is not configured.");
  await expect(
    page.getByRole("button", { name: "Save session", exact: true }),
  ).toBeDisabled();
  expect(saved).toBe(false);
});

test("cloud video transfers directly to storage and session saves by video ID", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const endpoint =
    "https://project.storage.supabase.co/storage/v1/upload/resumable/sign";
  const media = {
    id,
    name: "cloud.webm",
    type: "video/mp4",
    width: 320,
    height: 180,
    duration: 1,
    fps: 30,
    frames: [0, 1 / 30],
    variableFrameRate: false,
    hasAudio: false,
  };
  let bytes = Buffer.alloc(0);
  let offset = 0;
  let saved = false;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postData()!;
      expect(body).toContain(`"videoId":"${id}"`);
      expect(body).not.toContain('name="video"');
      saved = true;
      await route.fulfill({
        status: 201,
        json: {
          ...media,
          id: "22222222-2222-4222-8222-222222222222",
          name: "Cloud practice",
          date: "2026-10-05",
          makes: 0,
          misses: 0,
          reps: 0,
          target: 50,
          notes: "",
          tags: ["Shooting"],
          drawings: [],
          videoId: id,
          videoName: media.name,
          videoType: "video/mp4",
          createdAt: new Date().toISOString(),
          revision: "33333333-3333-4333-8333-333333333333",
        },
      });
    } else await route.fulfill({ json: [] });
  });
  await page.route("**/api/uploads", async (route) =>
    route.fulfill({
      status: 201,
      json: {
        id,
        name: media.name,
        type: "video/webm",
        size: bytes.length,
        offset: 0,
        state: "uploading",
        error: null,
        cloud: {
          token: "ticket",
          endpoint,
          bucket: "formsync-videos",
          object: `owner/${id}/original`,
        },
      },
    }),
  );
  await page.route(endpoint + "**", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "Location,Upload-Offset",
      "Tus-Resumable": "1.0.0",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "POST,PATCH,HEAD",
        },
      });
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 201,
        headers: { ...headers, Location: endpoint + "/ticket" },
      });
    expect(route.request().method()).toBe("PATCH");
    offset += route.request().postDataBuffer()!.length;
    await route.fulfill({
      status: 204,
      headers: { ...headers, "Upload-Offset": String(offset) },
    });
  });
  await page.route(`**/api/uploads/${id}`, async (route) =>
    route.fulfill({
      json: {
        id,
        name: media.name,
        type: "video/webm",
        size: bytes.length,
        offset: bytes.length,
        state: "ready",
        error: null,
        media,
        cloud: {
          endpoint,
          bucket: "formsync-videos",
          object: `owner/${id}/original`,
        },
      },
    }),
  );
  await page.route(`**/api/videos/${id}/metadata`, async (route) =>
    route.fulfill({ json: media }),
  );
  await page.route(`**/api/videos/${id}?optimized=1**`, async (route) =>
    route.fulfill({ body: bytes, contentType: "video/webm" }),
  );
  await page.goto("http://127.0.0.1:3001");
  bytes = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const stream = canvas.captureStream(30);
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      return new Promise<number[]>((resolve) => {
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = async () => {
          clearInterval(timer);
          stream.getTracks().forEach((track) => track.stop());
          resolve(
            Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
          );
        };
        const timer = setInterval(() => {
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#b7f76b";
          ctx.fillRect(0, 0, 320, 180);
        }, 33);
        recorder.start();
        setTimeout(() => recorder.stop(), 500);
      });
    }),
  );
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Upload a training video")
    .setInputFiles({ name: media.name, mimeType: "video/webm", buffer: bytes });
  await expect(
    page.getByRole("button", { name: "Play video", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  expect(offset).toBe(bytes.length);
  const previousSource = await page
    .locator(".video-plane video")
    .getAttribute("src");
  await page.locator(".video-plane video").dispatchEvent("error");
  await page
    .getByRole("button", { name: "Retry video preparation", exact: true })
    .click();
  await expect(page.locator(".video-plane video")).not.toHaveAttribute(
    "src",
    previousSource!,
  );
  await expect(
    page.getByRole("button", { name: "Play video", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Drill name", { exact: true }).fill("Cloud practice");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.locator(".success-feedback")).toContainText(
    "Session saved",
  );
  expect(saved).toBe(true);
});
