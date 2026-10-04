import { expect, test } from "@playwright/test";

test("dashboard reports upload progress and cancels an in-flight transfer", async ({
  page,
}) => {
  const id = "00000000-0000-4000-8000-000000000001";
  let patchStarted: () => void = () => {};
  let releasePatch: () => void = () => {};
  const patchReady = new Promise<void>((resolve) => {
    patchStarted = resolve;
  });
  const patchReleased = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });

  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        id,
        name: "practice.webm",
        type: "video/webm",
        size: 4,
        offset: 0,
        state: "uploading",
        error: null,
        created_at: new Date().toISOString(),
      },
    });
  });
  await page.route(`**/api/uploads/${id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      patchStarted();
      await patchReleased;
      await route
        .fulfill({
          status: 409,
          json: { error: "Upload canceled." },
        })
        .catch(() => {});
      return;
    }
    if (route.request().method() === "DELETE") {
      releasePatch();
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        id,
        name: "practice.webm",
        type: "video/webm",
        size: 4,
        offset: 0,
        state: "uploading",
        error: null,
      },
    });
  });

  await page.goto("http://127.0.0.1:3001");
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Upload a training video").setInputFiles({
    name: "practice.webm",
    mimeType: "video/webm",
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  });
  await expect(
    page.getByRole("progressbar", { name: "Video upload progress" }),
  ).toBeVisible();
  await patchReady;
  await page.getByRole("button", { name: "Cancel upload" }).click();
  await expect(page.locator(".success-feedback")).toContainText(
    "Upload canceled",
  );
  await expect(
    page.getByRole("progressbar", { name: "Video upload progress" }),
  ).toHaveCount(0);
});

test("resumable upload API ingests a complete video and reports ready metadata", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const bytes = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      return new Promise<number[]>((resolve) => {
        let frame = 0;
        const timer = setInterval(() => {
          ctx.fillStyle = "#202a24";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "#b7f76b";
          ctx.fillRect(40 + frame++ * 2, 40, 50, 90);
        }, 33);
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = async () => {
          clearInterval(timer);
          stream.getTracks().forEach((track) => track.stop());
          resolve(
            Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
          );
        };
        recorder.start();
        setTimeout(() => recorder.stop(), 1200);
      });
    }),
  );
  const started = await request.post("http://127.0.0.1:3001/api/uploads", {
    data: { name: "resumable.webm", type: "video/webm", size: bytes.length },
  });
  expect(started.status()).toBe(201);
  const upload = await started.json();
  const chunk = await request.patch(
    `http://127.0.0.1:3001/api/uploads/${upload.id}`,
    { data: bytes, headers: { "Upload-Offset": "0" } },
  );
  const chunkBody = await chunk.json();
  expect(chunk.status(), JSON.stringify(chunkBody)).toBe(200);
  expect(chunkBody.offset).toBe(bytes.length);
  const completed = await request.post(
    `http://127.0.0.1:3001/api/uploads/${upload.id}`,
  );
  expect([200, 201]).toContain(completed.status());

  let status: Record<string, unknown> = await completed.json();
  const deadline = Date.now() + 60000;
  while (status.state !== "ready" && status.state !== "failed") {
    if (Date.now() > deadline) throw new Error("Video ingest timed out.");
    await page.waitForTimeout(500);
    const response = await request.get(
      `http://127.0.0.1:3001/api/uploads/${upload.id}`,
    );
    expect(response.status()).toBe(200);
    status = await response.json();
  }
  expect(status.state, String(status.error)).toBe("ready");
  expect(status.media).toMatchObject({
    id: upload.id,
    name: "resumable.webm",
    type: "video/webm",
  });
});
