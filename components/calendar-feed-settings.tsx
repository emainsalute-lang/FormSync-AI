"use client";
import { useEffect, useState } from "react";

export default function CalendarFeedSettings() {
  const [active, setActive] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/calendar/feed", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Calendar feed unavailable.");
    setActive(data.active);
  }
  useEffect(() => {
    void load().catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : "Calendar feed unavailable.",
      ),
    );
  }, []);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/calendar/feed", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create feed.");
      const feedUrl = new URL(data.path, window.location.origin).toString();
      setUrl(feedUrl);
      setActive(true);
      await navigator.clipboard?.writeText(feedUrl).catch(() => {});
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create feed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/calendar/feed", { method: "DELETE" });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok)
        throw new Error(data?.error || "Could not revoke feed.");
      setActive(false);
      setUrl("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke feed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel hub-panel">
      <h2>Calendar subscription</h2>
      <p className="muted">
        Subscribe to the private iCalendar feed in Apple, Google, Outlook, or
        another calendar app. Calendar clients refresh it on their own schedule.
        Anyone with the feed URL can read your planned workouts.
      </p>
      {active ? (
        <div className="hub-controls">
          <span>
            {url ||
              "Active feed URL is hidden after creation; create a new link to rotate it."}
          </span>
          <button
            type="button"
            className="button-ghost"
            disabled={busy}
            onClick={() => void create()}
          >
            Rotate link
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => void revoke()}
          >
            Revoke feed
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => void create()}
        >
          Create calendar feed
        </button>
      )}
      {url && (
        <p role="status" className="success-feedback">
          Calendar URL copied if clipboard permission is available:{" "}
          <a href={url}>{url}</a>
        </p>
      )}
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
    </section>
  );
}
