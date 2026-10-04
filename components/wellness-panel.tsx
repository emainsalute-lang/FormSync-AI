"use client";
import { useState } from "react";
import { localDate, type Session } from "@/lib/model";
import {
  blankWellness,
  wellnessEntrySchema,
  wellnessTrainingDays,
  wellnessCsv,
  WELLNESS_METRICS,
  OUTCOME_METRICS,
  type WellnessEntry,
  type WellnessForm,
} from "@/lib/wellness";
export default function WellnessPanel({
  entries,
  sessions,
  saving,
  offline,
  onSave,
}: {
  entries: WellnessEntry[];
  sessions: Session[];
  saving: boolean;
  offline: boolean;
  onSave: (entries: WellnessEntry[]) => Promise<boolean>;
}) {
  const [form, setForm] = useState<WellnessForm>(
      () =>
        entries.find((e) => e.date === localDate()) ??
        blankWellness(localDate()),
    ),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [wellnessMetric, setWellnessMetric] =
      useState<keyof typeof WELLNESS_METRICS>("sleepHours"),
    [outcome, setOutcome] = useState<keyof typeof OUTCOME_METRICS>("success"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const blocked = saving || offline,
    existing = entries.find((e) => e.date === form.date);
  const included = (date: string) =>
    (!from || date >= from) && (!to || date <= to);
  const days = wellnessTrainingDays(entries, sessions).filter((d) =>
      included(d.date),
    ),
    history = entries
      .filter((e) => included(e.date))
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date)),
    weights = history
      .filter(
        (e): e is WellnessEntry & { bodyweightKg: number } =>
          e.bodyweightKg !== null,
      )
      .reverse();
  const pairs = days.flatMap((d) => {
    const x = d.wellness?.[wellnessMetric],
      y = d[outcome];
    return x === null || x === undefined || y === null
      ? []
      : [{ date: d.date, x, y }];
  });
  const xMetric = WELLNESS_METRICS[wellnessMetric],
    yMetric = OUTCOME_METRICS[outcome],
    yMax = outcome === "success" ? 100 : Math.max(1, ...pairs.map((p) => p.y));
  const weightX = (date: string) =>
    weights.length === 1
      ? 340
      : 70 +
        ((Date.parse(date + "T00:00:00Z") -
          Date.parse(weights[0].date + "T00:00:00Z")) /
          (Date.parse(weights.at(-1)!.date + "T00:00:00Z") -
            Date.parse(weights[0].date + "T00:00:00Z"))) *
          535;
  const oldestWeight = weights[0]?.bodyweightKg,
    latestWeight = weights.at(-1)?.bodyweightKg,
    minWeight = weights.length
      ? Math.min(...weights.map((w) => w.bodyweightKg)) - 1
      : 0,
    maxWeight = weights.length
      ? Math.max(...weights.map((w) => w.bodyweightKg)) + 1
      : 1;
  function choose(date: string) {
    setForm(entries.find((e) => e.date === date) ?? blankWellness(date));
    setError("");
    setMessage("");
  }
  async function save() {
    setError("");
    setMessage("");
    const now = new Date().toISOString();
    const parsed = wellnessEntrySchema.safeParse({
      ...form,
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your entries.");
      return;
    }
    if (
      await onSave([
        ...entries.filter((e) => e.date !== form.date),
        parsed.data,
      ])
    )
      setMessage(`Check-in saved for ${form.date}.`);
  }
  async function remove(entry: WellnessEntry) {
    if (
      !confirm(
        `Delete wellness check-in for ${entry.date}, including its bodyweight entry?`,
      )
    )
      return;
    if (await onSave(entries.filter((e) => e.id !== entry.id))) {
      if (form.date === entry.date) setForm(blankWellness(entry.date));
      setMessage(`Check-in deleted for ${entry.date}.`);
    }
  }
  function csv() {
    const url = URL.createObjectURL(
        new Blob([wellnessCsv(history)], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "formsync-wellness.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const number = (
    key: "sleepHours" | "bodyweightKg",
    label: string,
    max: number,
    step: string,
    min = 0,
  ) => (
    <label className="field-label">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder="Not reported"
        value={form[key] ?? ""}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: e.target.value === "" ? null : Number(e.target.value),
          })
        }
      />
    </label>
  );
  const rating = (
    key: "sleepQuality" | "soreness" | "stress" | "mood",
    label: string,
    options: string[],
  ) => (
    <label className="field-label">
      {label}
      <select
        aria-label={label}
        value={form[key] ?? ""}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: e.target.value === "" ? null : Number(e.target.value),
          })
        }
      >
        <option value="">Not reported</option>
        {options.map((text, i) => (
          <option key={i} value={i + 1}>
            {i + 1} — {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="wellness-workspace">
      <div className="hub-two-columns">
        <section className="panel hub-panel">
          <h2>Daily wellness check-in</h2>
          <p className="muted">
            Report how you feel and the previous night's sleep. Each date has
            one check-in; saving again updates it. Every measurement is
            optional.
          </p>
          <form
            className="hub-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={blocked}>
              <label className="field-label">
                Check-in date
                <input
                  type="date"
                  required
                  max={localDate()}
                  value={form.date}
                  onChange={(e) => choose(e.target.value)}
                />
              </label>
              <div className="wellness-fields">
                {number("sleepHours", "Sleep duration (hours)", 24, "0.25")}
                {rating("sleepQuality", "Sleep quality", [
                  "Very poor",
                  "Poor",
                  "Fair",
                  "Good",
                  "Excellent",
                ])}
                {rating("soreness", "Muscle soreness", [
                  "None",
                  "Mild",
                  "Moderate",
                  "High",
                  "Very high",
                ])}
                {rating("stress", "Stress level", [
                  "Very low",
                  "Low",
                  "Moderate",
                  "High",
                  "Very high",
                ])}
                {rating("mood", "Mood", [
                  "Very low",
                  "Low",
                  "Neutral",
                  "Good",
                  "Excellent",
                ])}
                {number("bodyweightKg", "Bodyweight (kg)", 500, "0.1", 1)}
              </div>
              <label className="field-label">
                Wellness notes
                <textarea
                  maxLength={2000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional context for today"
                />
              </label>
              <button className="button-primary" type="submit">
                {existing ? "Update check-in" : "Save check-in"}
              </button>
            </fieldset>
          </form>
          <p className="muted text-sm">
            Ratings run from 1 to 5. Higher sleep quality and mood are better;
            higher soreness and stress mean more discomfort or stress. Blank
            means not reported.
          </p>
          {error && (
            <p className="feedback" role="alert">
              {error}
            </p>
          )}
          <p role="status" className="wellness-status">
            {message}
          </p>
        </section>
        <section className="panel hub-panel">
          <h2>Bodyweight history</h2>
          <p className="muted">
            Bodyweight is recorded in kilograms. Only reported weigh-ins appear.
          </p>
          <div className="wellness-weight-summary">
            <strong>
              {latestWeight === undefined
                ? "No weigh-ins"
                : latestWeight + " kg"}
            </strong>
            <span className="muted">
              {weights.length} recorded weigh-ins
              {oldestWeight !== undefined &&
              latestWeight !== undefined &&
              weights.length > 1
                ? ` · Change: ${Math.round((latestWeight - oldestWeight) * 10) / 10} kg`
                : ""}
            </span>
          </div>
          {weights.length ? (
            <>
              <svg
                className="trend-chart"
                viewBox="0 0 640 250"
                role="img"
                aria-label="Bodyweight history chart"
              >
                <text x="12" y="20" fill="#9aabab" fontSize="12">
                  {maxWeight.toFixed(1)} kg
                </text>
                <text x="12" y="210" fill="#9aabab" fontSize="12">
                  {minWeight.toFixed(1)} kg
                </text>
                <line x1="65" y1="220" x2="620" y2="220" stroke="#39413d" />
                <polyline
                  fill="none"
                  stroke="#55d8f5"
                  strokeWidth="2"
                  points={weights
                    .map(
                      (e, i) =>
                        `${weightX(e.date)},${215 - ((e.bodyweightKg - minWeight) / (maxWeight - minWeight)) * 185}`,
                    )
                    .join(" ")}
                />
                {weights.map((e, i) => (
                  <circle
                    key={e.id}
                    cx={weightX(e.date)}
                    cy={
                      215 -
                      ((e.bodyweightKg - minWeight) / (maxWeight - minWeight)) *
                        185
                    }
                    r="5"
                    fill="#b7f76b"
                  >
                    <title>
                      {e.date}: {e.bodyweightKg} kg
                    </title>
                  </circle>
                ))}
                <text x="70" y="242" fill="#9aabab" fontSize="11">
                  {weights[0].date}
                </text>
                <text
                  x="620"
                  y="242"
                  textAnchor="end"
                  fill="#9aabab"
                  fontSize="11"
                >
                  {weights.at(-1)?.date}
                </text>
              </svg>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Bodyweight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weights
                      .slice()
                      .reverse()
                      .map((e) => (
                        <tr key={e.id}>
                          <td>{e.date}</td>
                          <td>{e.bodyweightKg} kg</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p>Add a bodyweight measurement to your daily check-in.</p>
          )}
        </section>
      </div>
      <section className="panel hub-panel">
        <h2>Wellness & training outcomes</h2>
        <p className="muted">
          Compare reports with training on the same calendar date. Daily success
          is weighted by attempts, repetitions are summed, and load is the sum
          of sessions with both duration and session RPE. This shows
          associations, not cause and effect.
        </p>
        <div className="hub-controls">
          <label className="field-label">
            Wellness comparison metric
            <select
              value={wellnessMetric}
              onChange={(e) =>
                setWellnessMetric(e.target.value as typeof wellnessMetric)
              }
            >
              {Object.entries(WELLNESS_METRICS).map(([key, m]) => (
                <option key={key} value={key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Training outcome
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as typeof outcome)}
            >
              {Object.entries(OUTCOME_METRICS).map(([key, m]) => (
                <option key={key} value={key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Wellness history from
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field-label">
            Wellness history to
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            className="button-ghost"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            All wellness dates
          </button>
        </div>
        {from && to && from > to ? (
          <p role="alert">Choose an end date on or after the start date.</p>
        ) : pairs.length ? (
          <>
            <svg
              viewBox="0 0 640 290"
              className="trend-chart wellness-comparison-chart"
              role="img"
              aria-label={`${xMetric.label} versus ${yMetric.label}`}
            >
              <line x1="65" y1="225" x2="605" y2="225" stroke="#657267" />
              <line x1="65" y1="25" x2="65" y2="225" stroke="#657267" />
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <g key={t}>
                  <line
                    x1="65"
                    y1={225 - t * 195}
                    x2="605"
                    y2={225 - t * 195}
                    stroke="#2a2e2e"
                  />
                  <text
                    x="55"
                    y={229 - t * 195}
                    textAnchor="end"
                    fill="#9aabab"
                    fontSize="12"
                  >
                    {Math.round(yMax * t * 10) / 10}
                  </text>
                  <text
                    x={65 + t * 535}
                    y="244"
                    textAnchor="middle"
                    fill="#9aabab"
                    fontSize="12"
                  >
                    {Math.round(
                      (xMetric.min + (xMetric.max - xMetric.min) * t) * 10,
                    ) / 10}
                  </text>
                </g>
              ))}
              {pairs.map((p) => (
                <circle
                  key={p.date}
                  cx={
                    65 +
                    ((p.x - xMetric.min) / (xMetric.max - xMetric.min)) * 535
                  }
                  cy={225 - (p.y / yMax) * 195}
                  r="6"
                  fill="#b7f76b"
                  stroke="#101212"
                >
                  <title>
                    {p.date}: {p.x} {xMetric.unit}; {p.y} {yMetric.unit}
                  </title>
                </circle>
              ))}
              <text
                x="330"
                y="278"
                textAnchor="middle"
                fill="#9aabab"
                fontSize="13"
              >
                {xMetric.label} ({xMetric.unit})
              </text>
              <text x="68" y="15" fill="#9aabab" fontSize="12">
                {yMetric.label} ({yMetric.unit})
              </text>
            </svg>
            <p className="wellness-pairs">
              {pairs.length} matched {pairs.length === 1 ? "day" : "days"}.
              Hover over a point for exact values; the table below provides
              every measurement.
            </p>
          </>
        ) : (
          <p className="wellness-empty-comparison">
            No matched reports yet. Log the selected wellness metric and a
            training outcome on the same date.
          </p>
        )}
        <div className="table-scroll">
          <table className="wellness-day-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>{xMetric.label}</th>
                <th>Sessions</th>
                <th>Reps</th>
                <th>Success</th>
                <th>Duration</th>
                <th>Session load</th>
              </tr>
            </thead>
            <tbody>
              {days
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.wellness?.[wellnessMetric] ?? "—"}</td>
                    <td>{d.sessions}</td>
                    <td>{d.reps ?? "—"}</td>
                    <td>{d.success === null ? "—" : d.success + "%"}</td>
                    <td>{d.duration === null ? "—" : d.duration + " min"}</td>
                    <td>
                      {d.load === null
                        ? "—"
                        : `${d.load} AU (${d.loadReports}/${d.sessions} sessions)`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel hub-panel">
        <div className="wellness-history-heading">
          <h2>Check-in history</h2>
          <button
            className="button-ghost"
            onClick={csv}
            disabled={!history.length}
          >
            Export wellness CSV
          </button>
        </div>
        <div className="table-scroll">
          <table className="wellness-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Sleep</th>
                <th>Quality</th>
                <th>Soreness</th>
                <th>Stress</th>
                <th>Mood</th>
                <th>Bodyweight</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.sleepHours === null ? "—" : e.sleepHours + " h"}</td>
                  <td>{e.sleepQuality ?? "—"}</td>
                  <td>{e.soreness ?? "—"}</td>
                  <td>{e.stress ?? "—"}</td>
                  <td>{e.mood ?? "—"}</td>
                  <td>
                    {e.bodyweightKg === null ? "—" : e.bodyweightKg + " kg"}
                  </td>
                  <td className="wellness-notes">{e.notes || "—"}</td>
                  <td>
                    <div className="wellness-actions">
                      <button
                        className="text-link"
                        disabled={blocked}
                        onClick={() => choose(e.date)}
                        aria-label={`Edit wellness ${e.date}`}
                      >
                        Edit
                      </button>
                      <button
                        className="text-link"
                        disabled={blocked}
                        onClick={() => void remove(e)}
                        aria-label={`Delete wellness ${e.date}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history.length && <p>No check-ins in this date range.</p>}
      </section>
    </div>
  );
}
