"use client";

import { useEffect, useState } from "react";
import type { Session } from "@/lib/model";

type ShareLink = {
  id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export default function SessionSharing({
  session,
  disabled = false,
}: {
  session: Session;
  disabled?: boolean;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [days, setDays] = useState("30");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(
      `/api/share-links?sessionId=${encodeURIComponent(session.id)}`,
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not load share links.");
    setLinks(data);
  }
  useEffect(() => {
    setUrl("");
    setError("");
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Sharing unavailable."),
    );
  }, [session.id]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          expiresInDays: days === "never" ? null : Number(days),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create link.");
      const shareUrl = new URL(
        `/share/${data.token}`,
        window.location.origin,
      ).toString();
      setUrl(shareUrl);
      await navigator.clipboard?.writeText(shareUrl).catch(() => {});
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create link.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/share-links/${id}`, {
        method: "DELETE",
      });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok)
        throw new Error(data?.error || "Could not revoke link.");
      await load();
      setUrl("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke link.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel hub-panel">
      <h2>Share this session</h2>
      <p className="muted">
        Create a read-only link to this clip. Anyone with the link can view it;
        revoke it at any time.
      </p>
      <div className="hub-controls">
        <label className="field-label">
          Link expires
          <select
            value={days}
            onChange={(event) => setDays(event.target.value)}
            disabled={disabled || busy}
          >
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
            <option value="never">Never</option>
          </select>
        </label>
        <button
          type="button"
          className="button-primary"
          onClick={() => void create()}
          disabled={disabled || busy}
        >
          {busy ? "Working…" : "Create share link"}
        </button>
      </div>
      {url && (
        <p className="success-feedback" role="status">
          Link copied if clipboard permission is available:{" "}
          <a href={url}>{url}</a>
        </p>
      )}
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      <ul className="hub-list" aria-label="Share links">
        {links.map((link) => {
          const expired =
            link.expires_at !== null &&
            Date.parse(link.expires_at) <= Date.now();
          return (
            <li key={link.id}>
              <span>
                Created {new Date(link.created_at).toLocaleDateString()} ·{" "}
                {link.revoked_at ? "Revoked" : expired ? "Expired" : "Active"}
              </span>
              {!link.revoked_at && !expired && (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => void revoke(link.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
