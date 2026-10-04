import assert from "node:assert/strict";
import test from "node:test";
import { uploadVideo, type UploadProgress } from "../lib/upload-client";
import { UPLOAD_CHUNK_BYTES } from "../lib/upload-constants";

const media = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "practice.webm",
  type: "video/webm",
  width: 640,
  height: 360,
  duration: 1,
  fps: 30,
  frames: [0, 1 / 30],
  variableFrameRate: false,
  hasAudio: false,
};

function record(
  offset: number,
  state: "uploading" | "queued" | "processing" | "ready",
) {
  return {
    id: media.id,
    name: media.name,
    type: media.type,
    size: UPLOAD_CHUNK_BYTES + 9,
    offset,
    state,
    error: null,
    ...(state === "ready" ? { media } : {}),
  };
}

test("resumes at the server offset after an ambiguous chunk failure", async () => {
  const originalFetch = globalThis.fetch;
  const file = new File([new Uint8Array(UPLOAD_CHUNK_BYTES + 9)], media.name, {
    type: media.type,
  });
  let offset = 0;
  let state: "uploading" | "queued" | "ready" = "uploading";
  let firstPatch = true;
  const patchOffsets: number[] = [];
  const progress: UploadProgress[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url === "/api/uploads" && method === "POST")
      return Response.json(record(offset, state));
    if (url === `/api/uploads/${media.id}` && method === "PATCH") {
      const requestOffset = Number(
        new Headers(init?.headers).get("Upload-Offset"),
      );
      patchOffsets.push(requestOffset);
      assert.equal(requestOffset, offset);
      offset += (init?.body as Blob).size;
      if (firstPatch) {
        firstPatch = false;
        throw new TypeError("Connection interrupted after server write.");
      }
      return Response.json(record(offset, state));
    }
    if (url === `/api/uploads/${media.id}` && method === "POST") {
      state = "queued";
      return Response.json(record(offset, state));
    }
    if (url === `/api/uploads/${media.id}` && method === "GET") {
      if (state === "queued") state = "ready";
      return Response.json(record(offset, state));
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    const result = await uploadVideo(
      file,
      "",
      new AbortController().signal,
      (value) => progress.push(value),
    );
    assert.deepEqual(result, media);
    assert.deepEqual(patchOffsets, [0, UPLOAD_CHUNK_BYTES]);
    assert.ok(
      progress.some(
        (value) =>
          value.phase === "uploading" &&
          value.uploadedBytes === UPLOAD_CHUNK_BYTES,
      ),
    );
    assert.ok(progress.some((value) => value.phase === "processing"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resumes a persisted upload without sending already received bytes", async () => {
  const originalFetch = globalThis.fetch;
  const file = new File([new Uint8Array(UPLOAD_CHUNK_BYTES + 9)], media.name, {
    type: media.type,
  });
  let offset = UPLOAD_CHUNK_BYTES;
  let state: "uploading" | "queued" | "ready" = "uploading";
  const patchOffsets: number[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url === `/api/uploads/${media.id}` && method === "GET") {
      if (state === "queued") state = "ready";
      return Response.json(record(offset, state));
    }
    if (url === `/api/uploads/${media.id}` && method === "PATCH") {
      const requestOffset = Number(
        new Headers(init?.headers).get("Upload-Offset"),
      );
      patchOffsets.push(requestOffset);
      assert.equal(requestOffset, offset);
      offset += (init?.body as Blob).size;
      return Response.json(record(offset, state));
    }
    if (url === `/api/uploads/${media.id}` && method === "POST") {
      state = "queued";
      return Response.json(record(offset, state));
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    const result = await uploadVideo(
      file,
      media.id,
      new AbortController().signal,
      () => {},
    );
    assert.deepEqual(result, media);
    assert.deepEqual(patchOffsets, [UPLOAD_CHUNK_BYTES]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
