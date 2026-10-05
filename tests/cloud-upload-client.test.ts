import assert from "node:assert/strict";
import test from "node:test";
import { transferCloudVideo } from "../lib/cloud-upload-client";
import type { UploadProgress } from "../lib/upload-client";

const ticket = {
  token: "signed-token",
  endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
  bucket: "formsync-videos",
  object: "owner/id/original",
};
test("direct cloud upload recovers an ambiguous chunk write through HEAD", async () => {
  const originalFetch = globalThis.fetch;
  const file = new File([new Uint8Array(9)], "practice.mov", {
    type: "video/quicktime",
  });
  const calls: string[] = [];
  const progress: UploadProgress[] = [];
  let offset = 0;
  globalThis.fetch = async (input, init) => {
    const method = init?.method || "GET";
    calls.push(`${method} ${input}`);
    assert.equal(new Headers(init?.headers).get("x-signature"), ticket.token);
    if (method === "POST") {
      assert.equal(new Headers(init?.headers).get("Upload-Length"), "9");
      return new Response(null, {
        status: 201,
        headers: { Location: ticket.endpoint + "/upload-1" },
      });
    }
    if (method === "PATCH") {
      offset += (init!.body as Blob).size;
      throw new TypeError("Network disconnected after write");
    }
    if (method === "HEAD")
      return new Response(null, {
        status: 200,
        headers: { "Upload-Offset": String(offset) },
      });
    throw new Error("Unexpected request");
  };
  try {
    await transferCloudVideo(
      file,
      "id",
      ticket,
      new AbortController().signal,
      (value) => progress.push(value),
    );
    assert.equal(offset, 9);
    assert.deepEqual(
      calls.map((call) => call.split(" ")[0]),
      ["POST", "PATCH", "HEAD"],
    );
    assert.equal(progress.at(-1)?.uploadedBytes, 9);
    assert.ok(calls.every((call) => !call.includes("/api/uploads")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud transfer refuses a storage redirect to another origin", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {
      status: 201,
      headers: { Location: "https://untrusted.example/upload" },
    });
  };
  try {
    await assert.rejects(
      () =>
        transferCloudVideo(
          new File(["video"], "video.mp4", { type: "video/mp4" }),
          "another-id",
          ticket,
          new AbortController().signal,
          () => {},
        ),
      /Invalid cloud upload URL/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
