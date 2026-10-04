import { listSessions } from "@/lib/storage";
import { readWorkspace } from "@/lib/training-store";
import { dailyProgress, goalProgress } from "@/lib/training";
import { successRate, calculateSessionLoad } from "@/lib/model";
import PrintButton from "@/components/print-button";
import { appIdentity } from "@/lib/user-scope";
export const dynamic = "force-dynamic";
export default async function Report() {
  const identity = await appIdentity();
  const [sessions, workspace] = await Promise.all([
    listSessions(identity.userId, identity.accessibleOwnerIds),
    readWorkspace(identity.userId),
  ]);
  const days = dailyProgress(sessions);
  return (
    <main className="report-sheet">
      <a href="/training" className="text-link print-button">
        Back to training hub
      </a>
      <h1>FormSync AI progress report</h1>
      <p>
        {workspace.profile.name} · {workspace.profile.sport} · Generated{" "}
        {new Date().toISOString().slice(0, 10)}
      </p>
      <PrintButton />
      <div className="report-summary">
        <p>
          {sessions.length} sessions · {days.length} practice dates ·{" "}
          {sessions.reduce((n, s) => n + s.reps, 0)} repetitions
        </p>
        <p>
          Overall success:{" "}
          {successRate(
            sessions.reduce((n, s) => n + s.makes, 0),
            sessions.reduce((n, s) => n + s.misses, 0),
          ) ?? "No attempts"}
          {sessions.some((s) => s.makes + s.misses) ? "%" : ""}
        </p>
      </div>
      <h2>Goals</h2>
      {workspace.goals.map((g) => (
        <p key={g.id}>
          {g.name}: {goalProgress(g, sessions).value ?? "No attempts"} /{" "}
          {g.target} {g.metric} · {g.from} to {g.to}
        </p>
      ))}
      <h2>Practice history</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date / Drill</th>
              <th>Reps</th>
              <th>Success</th>
              <th>Duration / Session RPE / Load</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.date}
                  <br />
                  {s.name}
                </td>
                <td>
                  {s.reps} / {s.target}
                </td>
                <td>
                  {successRate(s.makes, s.misses) === null
                    ? "—"
                    : successRate(s.makes, s.misses) + "%"}
                </td>
                <td>
                  {s.durationMinutes === null || s.durationMinutes === undefined
                    ? "—"
                    : s.durationMinutes + " min"}
                  <br />
                  {s.sessionRpe === null || s.sessionRpe === undefined
                    ? "—"
                    : s.sessionRpe + " / 10"}
                  <br />
                  {calculateSessionLoad(s.durationMinutes, s.sessionRpe) ===
                  null
                    ? "—"
                    : calculateSessionLoad(s.durationMinutes, s.sessionRpe) +
                      " AU"}
                </td>
                <td className="report-notes">
                  {s.notes}
                  {workspace.comments
                    .filter((c) => c.sessionId === s.id)
                    .map((c) => (
                      <p key={c.id}>
                        {c.author}: {c.text}
                      </p>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sessions.length && <p>No sessions logged.</p>}
      <h2>Wellness & bodyweight history</h2>
      <p>
        Sleep refers to the previous night. Ratings: quality/mood 1 = very
        poor/low, 5 = excellent; soreness/stress 1 = none/very low, 5 = very
        high. Blank measurements are shown as a dash.
      </p>
      {workspace.wellness.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Sleep</th>
                <th>Quality</th>
                <th>Soreness</th>
                <th>Stress</th>
                <th>Mood</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {workspace.wellness
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((w) => (
                  <tr key={w.id}>
                    <td>{w.date}</td>
                    <td>{w.sleepHours === null ? "—" : w.sleepHours + " h"}</td>
                    <td>{w.sleepQuality ?? "—"}</td>
                    <td>{w.soreness ?? "—"}</td>
                    <td>{w.stress ?? "—"}</td>
                    <td>{w.mood ?? "—"}</td>
                    <td>
                      {w.bodyweightKg === null ? "—" : w.bodyweightKg + " kg"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No wellness check-ins logged.</p>
      )}
      <p>
        Session load = duration in minutes × whole-session RPE (0–10), expressed
        in arbitrary units (AU). It is independent of individual set ratings.
      </p>
      <p className="muted">
        Pose measurements are camera-view estimates. This report contains
        practice records and local review notes.
      </p>
    </main>
  );
}
