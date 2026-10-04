"use client";
import { useCallback, useEffect, useState } from "react";
import type { StoragePolicy } from "@/lib/storage-policy";
type Job = {
  id: string;
  kind: string;
  state: string;
  attempts: number;
  error: string | null;
  created_at: string;
};
type Video = {
  id: string;
  name: string;
  duration: number;
  sessions: number;
  objects: { key: string; bytes: number; remote: number; created_at: string }[];
};
type Storage = {
  canManage: boolean;
  canDelete: boolean;
  provider: string;
  database: string;
  usage: { usedBytes: number; reservedBytes: number; quotaBytes: number };
  policy: StoragePolicy;
  videos: Video[];
  jobs: Job[];
  uploads: {
    id: string;
    name: string;
    size: number;
    offset: number;
    state: string;
    error: string | null;
  }[];
  backups: {
    id: string;
    createdAt: string;
    remote: boolean;
    fileCount: number;
  }[];
};
const bytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(2)} GB`
    : `${(n / 1024 ** 2).toFixed(1)} MB`;
export default function StoragePanel() {
  const [data, setData] = useState<Storage | null>(null),
    [policy, setPolicy] = useState<StoragePolicy | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/storage", { cache: "no-store" });
      const next = await r.json();
      if (!r.ok) throw new Error(next.error);
      setData(next);
      setPolicy((p) => p || next.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Storage unavailable");
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  async function action(body: unknown, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setNotice(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-5 md:p-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <a className="wordmark flex items-center gap-3" href="/">
          <img
            src="/brand/logo-white.png"
            alt=""
            width="52"
            height="20"
            className="h-auto w-16"
          />
          FormSync<span>AI</span>
        </a>
        <nav className="flex gap-3">
          <a className="button-ghost" href="/">
            Video workspace
          </a>
          <a className="button-ghost" href="/training">
            Training hub
          </a>
        </nav>
      </header>
      <div>
        <div className="eyebrow">YOUR VIDEO LIBRARY</div>
        <h1 className="text-3xl font-semibold">Storage & recovery</h1>
        <p className="mt-2 text-zinc-400">
          Manage space, keep your clips, and protect your training history.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-950 p-4 text-emerald-200"
        >
          {notice}
        </p>
      )}
      {!data ? (
        <p>Loading storage…</p>
      ) : (
        <>
          <section className="panel space-y-3 p-5">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">Storage usage</h2>
              <span className="text-sm text-zinc-400">
                {data.provider} · {data.database}
              </span>
            </div>
            <p>
              {bytes(data.usage.usedBytes)} stored +{" "}
              {bytes(data.usage.reservedBytes)} reserved /{" "}
              {bytes(data.usage.quotaBytes)}
            </p>
            <progress
              aria-label="Storage quota usage"
              max={data.usage.quotaBytes}
              value={data.usage.usedBytes + data.usage.reservedBytes}
              className="h-3 w-full accent-emerald-400"
            />
            {data.provider === "Local storage" && (
              <p className="text-sm text-amber-300">
                Cloud storage is ready to configure. Clips currently use this
                server’s persistent disk.
              </p>
            )}
          </section>
          <div className="grid gap-6 md:grid-cols-2">
            {policy && data.canManage && (
              <form
                className="panel space-y-4 p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    policy.retentionDays !== data.policy.retentionDays &&
                    policy.retentionDays > 0 &&
                    !window.confirm(
                      `Automatically delete videos older than ${policy.retentionDays} days? Session notes and metrics remain. Backups may retain earlier copies.`,
                    )
                  )
                    return;
                  void action(
                    { action: "policy", policy },
                    "Storage settings saved.",
                  );
                }}
              >
                <h2 className="text-lg font-semibold">Quota and retention</h2>
                <label className="block">
                  Quota (GB)
                  <input
                    className="mt-1 w-full rounded-lg bg-zinc-900 p-3"
                    type="number"
                    min="0.1"
                    max="1024"
                    step="0.1"
                    value={policy.quotaBytes / 1024 ** 3}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        quotaBytes: Math.round(
                          Number(e.target.value) * 1024 ** 3,
                        ),
                      })
                    }
                  />
                </label>
                <label className="block">
                  Video retention (days)
                  <input
                    className="mt-1 w-full rounded-lg bg-zinc-900 p-3"
                    type="number"
                    min="0"
                    max="3650"
                    value={policy.retentionDays}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        retentionDays: Number(e.target.value),
                      })
                    }
                  />
                  <small className="text-zinc-400">
                    0 keeps saved videos indefinitely. Expiration removes video
                    files; notes and metrics remain. Unattached clips expire
                    after 24 hours.
                  </small>
                </label>
                <label className="block">
                  Automatic backup interval (hours)
                  <input
                    className="mt-1 w-full rounded-lg bg-zinc-900 p-3"
                    type="number"
                    min="0"
                    max="168"
                    value={policy.backupHours}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        backupHours: Number(e.target.value),
                      })
                    }
                  />
                  <small className="text-zinc-400">
                    0 disables scheduled backups. The server must be running.
                  </small>
                </label>
                <label className="block">
                  Backups to keep
                  <input
                    className="mt-1 w-full rounded-lg bg-zinc-900 p-3"
                    type="number"
                    min="1"
                    max="30"
                    value={policy.backupKeep}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        backupKeep: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <button disabled={busy} className="button-primary">
                  Save storage settings
                </button>
              </form>
            )}
            {data.canManage && (
              <section className="panel space-y-4 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Recovery snapshots</h2>
                  <button
                    className="button-ghost"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        { action: "backup" },
                        "Backup queued. Its result will appear here.",
                      )
                    }
                  >
                    Back up now
                  </button>
                </div>
                <p className="text-sm text-zinc-400">
                  Includes the database, original videos, thumbnails and
                  playback copies. Recovery verifies SHA-256 checksums and
                  database integrity. Restore into an empty data directory with
                  the server stopped.
                </p>
                {!data.backups.length ? (
                  <p className="text-zinc-400">No completed backups yet.</p>
                ) : (
                  data.backups.map((b) => (
                    <div key={b.id} className="rounded-lg bg-zinc-900 p-3">
                      <p>{new Date(b.createdAt).toLocaleString()}</p>
                      <p className="text-xs text-zinc-400">
                        {b.remote ? "Cloud + local" : "Local"} · {b.fileCount}{" "}
                        files
                      </p>
                      <code className="break-all text-xs">{b.id}</code>
                    </div>
                  ))
                )}
                <a
                  href="/api/storage/recovery"
                  className="text-sm text-emerald-300"
                  download
                >
                  Download recovery instructions
                </a>
              </section>
            )}
          </div>
          {!!data.uploads.length && (
            <section className="panel space-y-3 p-5">
              <h2 className="text-lg font-semibold">Uploads</h2>
              {data.uploads.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-900 p-3"
                >
                  <div>
                    <p>{u.name}</p>
                    <p className="text-sm text-zinc-400">
                      {u.state} · {Math.round((u.offset / u.size) * 100)}%
                      {u.error && ` · ${u.error}`}
                    </p>
                  </div>
                  {u.state === "uploading" && (
                    <button
                      className="button-ghost"
                      onClick={async () => {
                        const r = await fetch(`/api/uploads/${u.id}`, {
                          method: "DELETE",
                        });
                        if (!r.ok) {
                          const result = await r.json();
                          setError(result.error);
                        } else await load();
                      }}
                    >
                      Cancel upload
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          <section className="panel space-y-4 p-5">
            <h2 className="text-lg font-semibold">Video library</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.videos.map((v) => {
                const optimized = v.objects.some((o) =>
                    o.key.startsWith("optimized/"),
                  ),
                  thumbnail = v.objects.some((o) =>
                    o.key.startsWith("thumbnails/"),
                  );
                return (
                  <article
                    key={v.id}
                    className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
                  >
                    {thumbnail ? (
                      <img
                        src={`/api/videos/${v.id}/thumbnail`}
                        alt={`Thumbnail for ${v.name}`}
                        className="aspect-video w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center text-zinc-500">
                        Preparing thumbnail
                      </div>
                    )}
                    <div className="space-y-2 p-4">
                      <h3 className="truncate font-medium" title={v.name}>
                        {v.name}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {Math.round(v.duration)}s ·{" "}
                        {bytes(v.objects.reduce((n, o) => n + o.bytes, 0))} ·{" "}
                        {v.sessions} linked sessions
                      </p>
                      <p className="text-xs text-zinc-400">
                        {v.objects.length && v.objects.every((o) => o.remote)
                          ? "Cloud stored"
                          : "Server stored"}
                      </p>
                      {optimized && (
                        <a
                          className="inline-block text-sm text-emerald-300"
                          href={`/api/videos/${v.id}/optimized`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Play optimized video ↗
                        </a>
                      )}
                      {!v.sessions && data.canDelete && (
                        <button
                          className="button-ghost"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm("Delete this unattached video?"))
                              void action(
                                { action: "delete", id: v.id },
                                "Video deletion queued.",
                              );
                          }}
                        >
                          Delete video
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {!data.videos.length && (
              <p className="text-zinc-400">
                Your uploaded clips will appear here.
              </p>
            )}
          </section>
          <section className="panel space-y-3 p-5">
            <h2 className="text-lg font-semibold">Background processing</h2>
            {data.jobs.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 py-3"
              >
                <div>
                  <p className="capitalize">
                    {j.kind} · {j.state}
                  </p>
                  {j.error && (
                    <p className="text-sm text-amber-300">{j.error}</p>
                  )}
                </div>
                {j.state === "failed" && (
                  <button
                    className="button-ghost"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        { action: "retry", id: j.id },
                        "Processing retry queued.",
                      )
                    }
                  >
                    Retry
                  </button>
                )}
              </div>
            ))}
            {!data.jobs.length && (
              <p className="text-zinc-400">No processing jobs yet.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
