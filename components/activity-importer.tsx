"use client";
import { useState } from "react";
import type { Workspace } from "@/lib/training";
import { parseWearableActivities } from "@/lib/wearable-import";

export default function ActivityImporter({
  workspace,
  offline,
  saving,
  onSave,
}: {
  workspace: Workspace;
  offline: boolean;
  saving: boolean;
  onSave: (value: Workspace) => Promise<boolean>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function importFile(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const imported = parseWearableActivities(file.name, await file.text());
      if (
        await onSave({
          ...workspace,
          wearableActivities: [
            ...workspace.wearableActivities,
            ...imported,
          ].slice(-1000),
        })
      )
        setNotice(
          `Imported ${imported.length} workout${imported.length === 1 ? "" : "s"}.`,
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Workout import failed.",
      );
    }
  }
  return (
    <section className="panel hub-panel">
      <h2>Import wearable workouts</h2>
      <p className="muted">
        Import standard TCX, GPX, or CSV exports. Data is stored in this private
        workspace; binary FIT files and direct vendor account sync are not
        supported.
      </p>
      <label className="field-label">
        Workout export
        <input
          type="file"
          accept=".tcx,.gpx,.csv,text/csv,application/xml"
          disabled={offline || saving}
          onChange={(event) => {
            void importFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-feedback">
          {notice}
        </p>
      )}
      <div className="hub-list" aria-label="Imported wearable workouts">
        {workspace.wearableActivities
          .slice()
          .reverse()
          .slice(0, 20)
          .map((item) => (
            <article key={item.id}>
              <strong>{item.name}</strong>
              <p>
                {item.source} ·{" "}
                {item.startedAt
                  ? new Date(item.startedAt).toLocaleString()
                  : "Date unavailable"}
              </p>
              <p>
                {item.durationSeconds === null
                  ? "Duration —"
                  : `${Math.round(item.durationSeconds / 60)} min`}
                {" · "}
                {item.distanceMeters === null
                  ? "Distance —"
                  : `${(item.distanceMeters / 1000).toFixed(2)} km`}
                {" · "}
                {item.averageHeartRate === null
                  ? "Avg HR —"
                  : `${item.averageHeartRate} bpm`}
              </p>
            </article>
          ))}
        {!workspace.wearableActivities.length && (
          <p>No wearable activities imported.</p>
        )}
      </div>
    </section>
  );
}
