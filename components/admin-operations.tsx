"use client";

import { useState } from "react";

type Operations = {
  jobs: {
    id: string;
    kind: string;
    media_id: string;
    state: string;
    attempts: number;
    error: string | null;
    created_at: string;
  }[];
  analytics: { day: string; event: string; count: number }[];
  events: {
    id: string;
    category: string;
    severity: string;
    message: string;
    created_at: string;
  }[];
  counts: { state: string; count: number }[];
  storage: { usedBytes: number; reservedBytes: number; quotaBytes: number };
  uptimeSeconds: number;
  memory: number;
};
export default function AdminOperations() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Operations | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(secret = token) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/operations", {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load operations.");
      setData(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Operations unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function action(payload: { action: string; jobId?: string }) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/admin/operations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operation failed.");
      setStatus(
        payload.action === "backup"
          ? `Backup created: ${result.destination}`
          : "Failed job queued for retry.",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="hub-main">
      <h1>Operations dashboard</h1>
      <p className="muted">
        Support tooling for processing failures, backup recovery and recent
        operational events.
      </p>
      <form
        className="hub-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="field-label">
          Admin access token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </label>
        <button className="button-primary" disabled={busy}>
          Load operations
        </button>
      </form>
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="success-feedback">
          {status}
        </p>
      )}
      {data && (
        <>
          <section className="overview-grid">
            <article className="stat-card">
              <span>Worker uptime</span>
              <strong>{Math.round(data.uptimeSeconds / 3600)} h</strong>
            </article>
            <article className="stat-card">
              <span>Memory RSS</span>
              <strong>{(data.memory / 1024 ** 2).toFixed(0)} MB</strong>
            </article>
            <article className="stat-card">
              <span>Storage</span>
              <strong>
                {(data.storage.usedBytes / 1024 ** 3).toFixed(2)} /{" "}
                {(data.storage.quotaBytes / 1024 ** 3).toFixed(1)} GB
              </strong>
            </article>
            <article className="stat-card">
              <span>Reserved uploads</span>
              <strong>
                {(data.storage.reservedBytes / 1024 ** 2).toFixed(0)} MB
              </strong>
            </article>
          </section>
          <section className="panel hub-panel">
            <h2>Backup and recovery</h2>
            <p className="muted">
              Create a checksummed snapshot in the configured backup directory.
            </p>
            <button
              type="button"
              className="button-primary"
              onClick={() => void action({ action: "backup" })}
              disabled={busy}
            >
              Create backup now
            </button>
          </section>
          <section className="panel hub-panel">
            <h2>Failed and pending jobs</h2>
            <ul className="hub-list">
              {data.jobs.map((job) => (
                <li key={job.id}>
                  <span>
                    {job.kind} · {job.media_id} · {job.state} · attempt{" "}
                    {job.attempts}
                    {job.error ? ` · ${job.error}` : ""}
                  </span>
                  {job.state === "failed" && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        void action({ action: "retry", jobId: job.id })
                      }
                    >
                      Retry
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!data.jobs.length && <p>No queued or failed jobs.</p>}
          </section>
          <section className="panel hub-panel">
            <h2>Recent operational events</h2>
            <ul className="hub-list">
              {data.events.map((event) => (
                <li key={event.id}>
                  <span>
                    {new Date(event.created_at).toLocaleString()} ·{" "}
                    {event.severity} · {event.category} · {event.message}
                  </span>
                </li>
              ))}
            </ul>
            {!data.events.length && <p>No recorded events.</p>}
          </section>
          <section className="panel hub-panel">
            <h2>Product workflow totals · 30 days</h2>
            <ul className="hub-list">
              {data.analytics.map((item) => (
                <li key={`${item.day}:${item.event}`}>
                  <span>
                    {item.day} · {item.event} · {item.count}
                  </span>
                </li>
              ))}
            </ul>
            {!data.analytics.length && <p>No workflow events recorded.</p>}
          </section>
        </>
      )}
    </main>
  );
}
