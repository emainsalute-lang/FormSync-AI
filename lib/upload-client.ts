import type { MediaInfo } from "./media-model";
import { UPLOAD_CHUNK_BYTES } from "./upload-constants";

type UploadState =
  "uploading" | "queued" | "processing" | "ready" | "failed" | "cancelled";
type UploadRecord = {
  id: string;
  name: string;
  type: string;
  size: number;
  offset: number;
  state: UploadState;
  error: string | null;
  media?: MediaInfo | null;
  cloud?: {
    token?: string;
    apiKey?: string;
    endpoint: string;
    bucket: string;
    object: string;
  };
};
export type UploadProgress = {
  uploadId: string;
  uploadedBytes: number;
  totalBytes: number;
  phase: "uploading" | "processing";
};

function isUploadState(state: unknown): state is UploadState {
  return (
    state === "uploading" ||
    state === "queued" ||
    state === "processing" ||
    state === "ready" ||
    state === "failed" ||
    state === "cancelled"
  );
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("The upload server returned an invalid response.");
  return value as Record<string, unknown>;
}

function parseUpload(value: unknown): UploadRecord {
  const row = object(value);
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.type !== "string" ||
    typeof row.size !== "number" ||
    typeof row.offset !== "number" ||
    !isUploadState(row.state) ||
    (row.error !== null && typeof row.error !== "string")
  )
    throw new Error("The upload server returned an invalid status.");
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    offset: row.offset,
    state: row.state,
    error: row.error,
    ...(row.cloud ? { cloud: parseCloud(row.cloud) } : {}),
    ...(row.media === undefined || row.media === null
      ? { media: null }
      : { media: parseMedia(row.media) }),
  };
}
function parseCloud(value: unknown): NonNullable<UploadRecord["cloud"]> {
  const row = object(value);
  if (
    typeof row.endpoint !== "string" ||
    typeof row.bucket !== "string" ||
    typeof row.object !== "string" ||
    (row.token !== undefined && typeof row.token !== "string") ||
    (row.apiKey !== undefined && typeof row.apiKey !== "string")
  )
    throw new Error("Invalid cloud upload configuration.");
  return {
    endpoint: row.endpoint,
    bucket: row.bucket,
    object: row.object,
    token: row.token as string | undefined,
    apiKey: row.apiKey as string | undefined,
  };
}

function parseMedia(value: unknown): MediaInfo {
  const row = object(value);
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.type !== "string" ||
    typeof row.width !== "number" ||
    typeof row.height !== "number" ||
    typeof row.duration !== "number" ||
    typeof row.fps !== "number" ||
    !Array.isArray(row.frames) ||
    !row.frames.every((frame) => typeof frame === "number") ||
    typeof row.variableFrameRate !== "boolean" ||
    typeof row.hasAudio !== "boolean"
  )
    throw new Error("The upload server returned invalid video metadata.");
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    width: row.width,
    height: row.height,
    duration: row.duration,
    fps: row.fps,
    frames: row.frames,
    variableFrameRate: row.variableFrameRate,
    hasAudio: row.hasAudio,
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("The upload server returned an invalid response.");
  }
}

async function status(id: string, signal: AbortSignal): Promise<UploadRecord> {
  const response = await fetch(`/api/uploads/${id}`, { signal });
  const body = await responseBody(response);
  if (!response.ok) {
    const row = object(body);
    throw new Error(
      typeof row.error === "string" ? row.error : "Upload status unavailable.",
    );
  }
  return parseUpload(body);
}

function assertMatches(upload: UploadRecord, file: File) {
  if (
    upload.name !== file.name ||
    upload.type !== file.type ||
    upload.size !== file.size
  )
    throw new Error(
      "This saved upload does not match the selected video. Choose the original file again.",
    );
  if (
    (upload.state === "failed" && !upload.cloud) ||
    upload.state === "cancelled"
  )
    throw new Error(upload.error || "This upload can no longer be resumed.");
}

function wait(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload canceled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    function cancel() {
      clearTimeout(timer);
      reject(new DOMException("Upload canceled", "AbortError"));
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export async function uploadVideo(
  file: File,
  resumeId: string,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<MediaInfo> {
  let upload: UploadRecord;
  if (resumeId) {
    upload = await status(resumeId, signal);
    assertMatches(upload, file);
  } else {
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        type: file.type,
        size: file.size,
      }),
      signal,
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const row = object(body);
      throw new Error(
        typeof row.error === "string" ? row.error : "Upload could not start.",
      );
    }
    upload = parseUpload(body);
  }
  assertMatches(upload, file);
  if (upload.cloud) {
    if (upload.state === "uploading") {
      if (!upload.cloud.token) throw new Error("Missing cloud upload token.");
      const { transferCloudVideo } = await import("./cloud-upload-client");
      await transferCloudVideo(
        file,
        upload.id,
        { ...upload.cloud, token: upload.cloud.token },
        signal,
        onProgress,
      );
    }
    if (upload.state !== "ready") {
      onProgress({
        uploadId: upload.id,
        uploadedBytes: file.size,
        totalBytes: file.size,
        phase: "processing",
      });
      const response = await fetch(`/api/uploads/${upload.id}`, {
        method: "POST",
        signal,
      });
      const body = await responseBody(response);
      if (!response.ok)
        throw new Error(
          typeof object(body).error === "string"
            ? String(object(body).error)
            : "Video processing failed.",
        );
      upload = parseUpload(body);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (upload.state === "processing" || upload.state === "queued") {
        if (Date.now() > deadline)
          throw new Error("Video processing took too long. Retry preparation.");
        await wait(signal, 1000);
        upload = await status(upload.id, signal);
      }
    }
    if (upload.state !== "ready" || !upload.media)
      throw new Error(
        upload.error || "Video processing failed. Retry preparation.",
      );
    return upload.media;
  }
  onProgress({
    uploadId: upload.id,
    uploadedBytes: upload.offset,
    totalBytes: file.size,
    phase: "uploading",
  });

  while (upload.state === "uploading" && upload.offset < file.size) {
    const offset = upload.offset;
    const chunk = file.slice(
      offset,
      Math.min(offset + UPLOAD_CHUNK_BYTES, file.size),
    );
    let advanced = false;
    for (let attempt = 0; attempt < 3 && !advanced; attempt++) {
      try {
        const response = await fetch(`/api/uploads/${upload.id}`, {
          method: "PATCH",
          headers: { "Upload-Offset": String(offset) },
          body: chunk,
          signal,
        });
        const body = await responseBody(response);
        if (response.ok) {
          const next = parseUpload(body);
          assertMatches(next, file);
          if (next.offset !== Math.min(offset + chunk.size, file.size))
            throw new Error("The server returned an unexpected upload offset.");
          upload = next;
          advanced = true;
          onProgress({
            uploadId: upload.id,
            uploadedBytes: upload.offset,
            totalBytes: file.size,
            phase: "uploading",
          });
          continue;
        }
        if (response.status !== 409 && response.status < 500) {
          const row = object(body);
          throw new Error(
            typeof row.error === "string" ? row.error : "Upload failed.",
          );
        }
      } catch (error) {
        if (signal.aborted) throw error;
        if (!(error instanceof TypeError)) throw error;
      }

      const latest = await status(upload.id, signal);
      assertMatches(latest, file);
      if (latest.offset !== offset) {
        upload = latest;
        advanced = true;
        onProgress({
          uploadId: upload.id,
          uploadedBytes: upload.offset,
          totalBytes: file.size,
          phase: "uploading",
        });
      } else if (attempt === 2) {
        throw new Error(
          `Upload paused at ${Math.floor((offset / file.size) * 100)}%. Resume to continue.`,
        );
      }
    }
  }

  if (upload.state === "uploading") {
    onProgress({
      uploadId: upload.id,
      uploadedBytes: file.size,
      totalBytes: file.size,
      phase: "processing",
    });
    const response = await fetch(`/api/uploads/${upload.id}`, {
      method: "POST",
      signal,
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const row = object(body);
      throw new Error(
        typeof row.error === "string" ? row.error : "Upload could not finish.",
      );
    }
    upload = parseUpload(body);
  }

  const processingDeadline = Date.now() + 5 * 60 * 1000;
  while (upload.state !== "ready") {
    if (upload.state === "failed" || upload.state === "cancelled")
      throw new Error(upload.error || "Video processing failed.");
    if (Date.now() >= processingDeadline)
      throw new Error(
        "Video processing is taking too long. Retry preparation to check again.",
      );
    onProgress({
      uploadId: upload.id,
      uploadedBytes: file.size,
      totalBytes: file.size,
      phase: "processing",
    });
    await wait(signal, 1000);
    upload = await status(upload.id, signal);
  }
  if (!upload.media)
    throw new Error("Video processing finished without video metadata.");
  return upload.media;
}
