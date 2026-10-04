"use client";

import { useEffect, useState } from "react";

type Settings = {
  configured: boolean;
  publicKey: string;
  subscribed: boolean;
  reminder: {
    hour: number;
    minute: number;
    timezone: string;
    enabled: boolean;
  } | null;
};
function decodeKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
export default function ReminderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/reminders", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Reminder settings unavailable.");
    setSettings(data);
    if (data.reminder)
      setTime(
        `${String(data.reminder.hour).padStart(2, "0")}:${String(data.reminder.minute).padStart(2, "0")}`,
      );
  }
  useEffect(() => {
    void load().catch((cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Reminder settings unavailable.",
      ),
    );
  }, []);
  async function enable() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!settings?.configured || !settings.publicKey)
        throw new Error(
          "Web Push is not configured by the server administrator.",
        );
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw new Error("This browser does not support push notifications.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Allow notifications in browser settings to enable reminders.",
        );
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(settings.publicKey),
      });
      const [hour, minute] = time.split(":").map(Number);
      const response = await fetch("/api/reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hour,
          minute,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          subscription: subscription.toJSON(),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not enable reminders.");
      setMessage("Daily training reminder enabled.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not enable reminders.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reminders", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not disable reminders.");
      const registration =
        await navigator.serviceWorker.getRegistration("/sw.js");
      await registration?.pushManager
        .getSubscription()
        .then((subscription) => subscription?.unsubscribe());
      setMessage("Training reminders disabled.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not disable reminders.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel hub-panel">
      <h2>Training reminders</h2>
      <p className="muted">
        Choose a daily local-time reminder. Push delivery requires the server’s
        VAPID keys and a running worker.
      </p>
      <div className="hub-controls">
        <label className="field-label">
          Reminder time
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            disabled={busy}
          />
        </label>
        {settings?.subscribed && settings.reminder?.enabled ? (
          <button
            type="button"
            className="button-ghost"
            onClick={() => void disable()}
            disabled={busy}
          >
            Disable reminders
          </button>
        ) : (
          <button
            type="button"
            className="button-primary"
            onClick={() => void enable()}
            disabled={busy || !settings?.configured}
          >
            {busy ? "Saving…" : "Enable push reminders"}
          </button>
        )}
      </div>
      {!settings?.configured && (
        <p className="muted">Push is not configured on this server.</p>
      )}
      {message && (
        <p role="status" className="success-feedback">
          {message}
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
