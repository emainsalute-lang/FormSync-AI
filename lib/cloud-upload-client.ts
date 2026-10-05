import type { UploadProgress } from "./upload-client";
type Ticket = {
  token: string;
  apiKey?: string;
  endpoint: string;
  bucket: string;
  object: string;
};
export async function transferCloudVideo(
  file: File,
  id: string,
  ticket: Ticket,
  signal: AbortSignal,
  progress: (value: UploadProgress) => void,
) {
  const key = `formsync-tus:${id}`;
  const headers = {
    "Tus-Resumable": "1.0.0",
    "x-signature": ticket.token,
    ...(ticket.apiKey ? { apikey: ticket.apiKey } : {}),
  };
  let url = "";
  try {
    url = localStorage.getItem(key) || "";
  } catch {}
  // Never send an upload token to a URL outside this project's storage endpoint.
  if (
    url &&
    (new URL(url).origin !== new URL(ticket.endpoint).origin ||
      !new URL(url).pathname.startsWith("/storage/v1/upload/resumable/"))
  )
    url = "";
  let offset = 0;
  if (url) {
    const response = await fetch(url, { method: "HEAD", headers, signal });
    if (response.ok) offset = Number(response.headers.get("Upload-Offset"));
    else if (response.status === 404 || response.status === 410) url = "";
    else throw new Error("Could not resume the cloud upload. Retry shortly.");
  }
  if (!url) {
    const encode = (value: string) =>
      btoa(String.fromCharCode(...new TextEncoder().encode(value)));
    const metadata = Object.entries({
      bucketName: ticket.bucket,
      objectName: ticket.object,
      contentType: file.type,
      cacheControl: "3600",
    })
      .map(([key, value]) => `${key} ${encode(value)}`)
      .join(",");
    const response = await fetch(ticket.endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Upload-Length": String(file.size),
        "Upload-Metadata": metadata,
      },
      signal,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail =
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : "";
      } catch {}
      throw new Error(
        `Cloud upload could not start (${response.status}). ${detail || "Check the Supabase bucket and file size limit."}`,
      );
    }
    if (!response.headers.get("Location"))
      throw new Error(
        "Supabase did not return an upload URL. Retry the upload.",
      );
    url = new URL(
      response.headers.get("Location")!,
      ticket.endpoint,
    ).toString();
    if (
      new URL(url).origin !== new URL(ticket.endpoint).origin ||
      !new URL(url).pathname.startsWith("/storage/v1/upload/resumable/")
    )
      throw new Error("Invalid cloud upload URL.");
    try {
      localStorage.setItem(key, url);
    } catch {}
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size)
    throw new Error("Invalid cloud upload offset.");
  progress({
    uploadId: id,
    uploadedBytes: offset,
    totalBytes: file.size,
    phase: "uploading",
  });
  while (offset < file.size) {
    const chunk = file.slice(
      offset,
      Math.min(offset + 6 * 1024 * 1024, file.size),
    );
    let advanced = false;
    for (let attempt = 0; attempt < 3 && !advanced; attempt++) {
      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            ...headers,
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: chunk,
          signal,
        });
        if (response.ok) {
          const next = Number(response.headers.get("Upload-Offset"));
          if (next !== offset + chunk.size)
            throw new Error("Invalid cloud upload offset.");
          offset = next;
          advanced = true;
        } else if (response.status < 500 && response.status !== 409)
          throw new Error(
            `Cloud upload failed (${response.status}). Check bucket permissions and file size limits.`,
          );
      } catch (error) {
        if (signal.aborted || !(error instanceof TypeError)) throw error;
      }
      if (!advanced) {
        const response = await fetch(url, { method: "HEAD", headers, signal });
        const next = Number(response.headers.get("Upload-Offset"));
        if (
          response.ok &&
          Number.isSafeInteger(next) &&
          next === offset + chunk.size
        ) {
          offset = next;
          advanced = true;
        } else if (attempt === 2)
          throw new Error("Cloud upload paused. Retry to resume.");
      }
    }
    progress({
      uploadId: id,
      uploadedBytes: offset,
      totalBytes: file.size,
      phase: "uploading",
    });
  }
  try {
    localStorage.removeItem(key);
  } catch {}
}
