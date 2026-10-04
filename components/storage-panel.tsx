"use client";

import { useEffect, useState } from "react";
import { supabaseConfigured } from "@/lib/supabase/config";

type StoredVideo = {
  sessionId: string;
  name: string;
  videoId: string;
  videoName: string;
  createdAt: string;
  bytes: number;
  thumbnailReady: boolean;
  optimizedReady: boolean;
};
type StorageOverview = {
  usage: {
    usedBytes: number;
    reservedBytes: number;
    quotaBytes: number;
    retentionDays: number;
  };
  policy: {
    quotaBytes: number;
    retentionDays: number;
  };
  storage: "local" | "cloud";
  videos: StoredVideo[];
  uploads: {
    id: string;
    name: string;
    size: number;
    offset: number;
    state: string;
    error: string | null;
    created_at: string;
  }[];
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index++) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

export default function StoragePanel() {
  const authenticatedMode = supabaseConfigured();
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [quotaGb, setQuotaGb] = useState("5");
  const [retentionDays, setRetentionDays] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/storage", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Storage details unavailable.");
      setOverview(data);
      setQuotaGb(String(data.policy.quotaBytes / 1024 ** 3));
      setRetentionDays(String(data.policy.retentionDays));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Storage details unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotaBytes: Number(quotaGb) * 1024 ** 3,
          retentionDays: Number(retentionDays),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Storage settings could not be saved.");
      setNotice("Storage settings saved.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Storage settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status">Loading storage details…</p>;
  if (!overview)
    return (
      <section className="panel hub-panel">
        <p role="alert">{error}</p>
        <button className="button-ghost" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );

  const total = overview.usage.usedBytes + overview.usage.reservedBytes;
  const percent = Math.min(
    100,
    Math.round((total / overview.usage.quotaBytes) * 100),
  );
  return (
    <div className="storage-panel">
      {error && (
        <p role="alert" className="feedback error-feedback">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-feedback">
          {notice}
        </p>
      )}
      <section className="panel hub-panel">
        <div className="storage-heading">
          <div>
            <h2>Storage usage</h2>
            <p className="muted">
              {overview.storage === "cloud"
                ? "S3-compatible cloud storage"
                : "Local filesystem storage"}
            </p>
          </div>
          <button
            type="button"
            className="button-ghost"
            disabled={saving}
            onClick={() => void load()}
          >
            Refresh storage
          </button>
        </div>
        <div className="storage-usage-label">
          <strong>{formatBytes(total)}</strong>
          <span>of {formatBytes(overview.usage.quotaBytes)}</span>
          <span>{percent}%</span>
        </div>
        <progress
          value={total}
          max={overview.usage.quotaBytes}
          aria-label="Storage quota usage"
        />
        <div className="storage-breakdown">
          <span>Stored objects: {formatBytes(overview.usage.usedBytes)}</span>
          <span>
            Reserved for uploads: {formatBytes(overview.usage.reservedBytes)}
          </span>
        </div>
        <p className="muted">
          Usage counts original videos, generated thumbnails, optimized playback
          copies, and reserved upload space.
        </p>
      </section>
      {authenticatedMode ? (
        <p className="muted">
          Storage quota and retention are managed by the server administrator.
          Usage above reflects your account&apos;s stored and reserved media.
        </p>
      ) : (
        <section className="panel hub-panel">
          <h2>Quota and retention</h2>
          <form
            className="storage-policy-form"
            onSubmit={(event) => void save(event)}
          >
            <label className="field-label">
              Storage quota (GB)
              <input
                type="number"
                min="0.1"
                max="1024"
                step="0.1"
                required
                value={quotaGb}
                onChange={(event) => setQuotaGb(event.target.value)}
              />
            </label>
            <label className="field-label">
              Retain videos for (days)
              <input
                type="number"
                min="0"
                max="3650"
                step="1"
                required
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
              />
            </label>
            <button className="button-primary" disabled={saving}>
              {saving ? "Saving…" : "Save storage settings"}
            </button>
          </form>
          <p className="storage-warning">
            Set retention to 0 to keep videos indefinitely. A retention limit
            permanently deletes video files older than the selected age,
            including files attached to saved sessions. Keep independent backups
            before enabling it.
          </p>
        </section>
      )}
      <section className="panel hub-panel">
        <h2>Saved videos</h2>
        {overview.videos.length ? (
          <div className="storage-video-list">
            {overview.videos.map((video) => (
              <article key={video.sessionId}>
                {video.thumbnailReady ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/videos/${video.videoId}/thumbnail`}
                    alt={`Thumbnail for ${video.name}`}
                  />
                ) : (
                  <div className="storage-thumbnail-pending">
                    {video.optimizedReady
                      ? "Processing thumbnail"
                      : "Queued for processing"}
                  </div>
                )}
                <div className="storage-video-info">
                  <strong>{video.name}</strong>
                  <span>{video.videoName}</span>
                  <span>
                    {formatBytes(video.bytes)} ·{" "}
                    {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                  <div className="storage-assets">
                    <span>
                      {video.thumbnailReady
                        ? "Thumbnail ready"
                        : "Thumbnail pending"}
                    </span>
                    {video.optimizedReady ? (
                      <details>
                        <summary>Preview optimized video</summary>
                        <video
                          controls
                          preload="none"
                          src={`/api/videos/${video.videoId}/optimized`}
                        />
                      </details>
                    ) : (
                      <span>Optimized copy pending</span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No saved videos yet.</p>
        )}
      </section>
      <section className="panel hub-panel">
        <h2>Uploads and processing</h2>
        {overview.uploads.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>FILE</th>
                  <th>STATUS</th>
                  <th>PROGRESS</th>
                  <th>DETAIL</th>
                </tr>
              </thead>
              <tbody>
                {overview.uploads.map((upload) => (
                  <tr key={upload.id}>
                    <td>{upload.name}</td>
                    <td>{upload.state}</td>
                    <td>
                      {formatBytes(upload.offset)} / {formatBytes(upload.size)}
                    </td>
                    <td>{upload.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No active or failed uploads.</p>
        )}
      </section>
    </div>
  );
}
