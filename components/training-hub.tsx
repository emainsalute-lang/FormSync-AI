"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Download,
  TrendingUp,
  Target,
  CalendarDays,
  ScanLine,
  Layers,
  MessageSquare,
  Database,
  Dumbbell,
  Users,
} from "lucide-react";
import { localDate, successRate, TAGS, type Session } from "@/lib/model";
import {
  csvSessions,
  dailyProgress,
  emptyWorkspace,
  goalProgress,
  type Workspace,
  type PoseAnalysis,
} from "@/lib/training";
import ClipComparison from "./clip-comparison";
import PoseReview from "./pose-review";
import WellnessPanel from "./wellness-panel";
import StoragePanel from "./storage-panel";
import PracticePanel from "./practice-panel";
import CoachTeamPanel from "./coach-team-panel";
import { supabaseConfigured } from "@/lib/supabase/config";
import { readTrainingSnapshot, writeTrainingSnapshot } from "@/lib/drafts";
import SessionSharing from "./session-sharing";
import ActivityImporter from "./activity-importer";
import ReminderSettings from "./reminder-settings";
import BillingPanel from "./billing-panel";
const tips: Record<Workspace["profile"]["sport"], string[]> = {
  Basketball: [
    "Capture shooting from the side to compare elbow extension and release timing.",
    "Compare makes and misses from the same camera position.",
    "Use knee and elbow angle ranges to compare your own consistent repetitions.",
  ],
  Running: [
    "Film perpendicular to the running direction with feet visible.",
    "Compare left and right knee and hip angles at matched stride phases.",
    "Use slow playback to inspect foot contact; pose estimates alone cannot measure ground forces.",
  ],
  Strength: [
    "Keep the full body in frame and use the same load and camera position for comparisons.",
    "Compare knee and hip angles at the deepest point and at full extension.",
    "Choose target ranges with a qualified coach rather than treating an arbitrary angle as ideal.",
  ],
  General: [
    "Film one athlete with the entire body visible.",
    "Compare clips from a fixed camera at the same movement phase.",
    "Track repetitions and outcomes alongside movement measurements.",
  ],
};
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function TrainingHub({
  ownerId = "local",
}: {
  ownerId?: string;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("Progress"),
    [selected, setSelected] = useState("");
  const [offline, setOffline] = useState(false);
  const state = useRef(workspace),
    savingRef = useRef(false);
  state.current = workspace;
  const [profile, setProfile] = useState({
    name: "Athlete",
    sport: "General" as Workspace["profile"]["sport"],
  });
  const [goal, setGoal] = useState({
    name: "",
    metric: "reps" as "reps" | "sessions" | "success",
    target: 100,
    from: localDate(),
    to: localDate(),
    tag: "",
  });
  const [plan, setPlan] = useState({
    name: "",
    date: localDate(),
    target: 50,
    tag: "Shooting" as Workspace["plans"][number]["tag"],
  });
  const [comment, setComment] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const [sr, wr] = await Promise.all([
        fetch("/api/sessions"),
        fetch("/api/workspace"),
      ]);
      if (!sr.ok || !wr.ok)
        throw new Error("Training data could not be loaded.");
      const s: Session[] = await sr.json(),
        w: Workspace = await wr.json();
      w.comments = w.comments.filter((c) =>
        s.some((row) => row.id === c.sessionId),
      );
      w.analyses = w.analyses.filter((a) =>
        s.some(
          (row) =>
            row.id === a.sessionId &&
            row.videoId === a.videoId &&
            (row.revision || row.createdAt) === a.sessionRevision,
        ),
      );
      setOffline(
        sr.headers.get("X-FormSync-Offline") === "1" ||
          wr.headers.get("X-FormSync-Offline") === "1",
      );
      setSessions(s);
      setWorkspace(w);
      state.current = w;
      setProfile(w.profile);
      setSelected((prev) =>
        s.some((row) => row.id === prev) ? prev : s[0]?.id || "",
      );
      await writeTrainingSnapshot(
        { version: 1, sessions: s, workspace: w },
        ownerId,
      );
    } catch (e) {
      try {
        const snapshot = await readTrainingSnapshot(ownerId);
        if (!snapshot) throw e;
        setSessions(snapshot.sessions);
        setWorkspace(snapshot.workspace);
        state.current = snapshot.workspace;
        setProfile(snapshot.workspace.profile);
        setSelected((prev) =>
          snapshot.sessions.some((row) => row.id === prev)
            ? prev
            : snapshot.sessions[0]?.id || "",
        );
        setOffline(true);
        setError("");
      } catch (snapshotError) {
        setError(
          snapshotError instanceof Error
            ? snapshotError.message
            : "Training data could not be loaded.",
        );
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function persist(next: Workspace): Promise<boolean> {
    if (offline) {
      setError(
        "You are viewing an offline snapshot. Connect to the server before saving.",
      );
      return false;
    }
    if (savingRef.current) return false;
    const previous = state.current;
    setWorkspace(next);
    savingRef.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed");
      setWorkspace(d);
      state.current = d;
      setNotice("Training changes saved.");
      return true;
    } catch (e) {
      setWorkspace(previous);
      state.current = previous;
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function exportVideo() {
    if (!current || savingRef.current) return;
    setSaving(true);
    savingRef.current = true;
    setError("");
    setNotice("Rendering annotated MP4…");
    try {
      const r = await fetch(`/api/sessions/${current.id}/export`, {
        method: "POST",
        headers: { "If-Match": `"${current.revision || current.createdAt}"` },
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Export failed");
      }
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "formsync-annotated.mp4";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Annotated video exported.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
      setNotice("");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }
  async function saveAnalysis(a: PoseAnalysis) {
    const w = state.current;
    return persist({
      ...w,
      analyses: [...w.analyses.filter((x) => x.sessionId !== a.sessionId), a],
    });
  }
  async function saveAnalysisTemplate(
    template: Workspace["analysisTemplates"][number],
  ) {
    const templates = state.current.analysisTemplates;
    return persist({
      ...state.current,
      analysisTemplates: [
        ...templates.filter((item) => item.id !== template.id),
        template,
      ],
    });
  }
  const current = sessions.find((s) => s.id === selected),
    days = dailyProgress(sessions),
    recent = days.slice(-20),
    maxReps = Math.max(1, ...recent.map((d) => d.reps));
  const best = sessions
    .filter((s) => s.makes + s.misses > 0)
    .sort(
      (a, b) =>
        (successRate(b.makes, b.misses) || 0) -
        (successRate(a.makes, a.misses) || 0),
    )[0];
  const thisWeek = sessions.filter((s) => {
    const delta =
      (new Date(localDate() + "T00:00:00Z").getTime() -
        new Date(s.date + "T00:00:00Z").getTime()) /
      86400000;
    return delta >= 0 && delta < 7;
  });
  return (
    <div className="hub-shell">
      <header className="hub-header">
        <Link href="/" className="wordmark">
          <img
            src="/brand/logo-black.png"
            alt=""
            width="52"
            height="20"
            className="h-auto w-16"
          />{" "}
          FormSync<span>AI</span>
        </Link>
        <Link href="/" className="button-ghost">
          <ArrowLeft size={16} /> Video workspace
        </Link>
      </header>
      <main className="hub-main">
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR TRAINING SYSTEM</div>
            <h1>
              See progress. <span>Build consistency.</span>
            </h1>
            <p>
              Movement analysis, comparisons, plans, and reports in one place.
            </p>
          </div>
          <button
            className="button-ghost"
            onClick={() => void load()}
            disabled={saving}
          >
            Refresh training data
          </button>
        </div>
        <nav className="hub-tabs" aria-label="Training sections">
          {[
            { name: "Progress", icon: TrendingUp },
            { name: "Wellness", icon: Activity },
            { name: "Plans & goals", icon: CalendarDays },
            { name: "Practice", icon: Dumbbell },
            { name: "Teams", icon: Users },
            { name: "Movement", icon: ScanLine },
            { name: "Compare", icon: Layers },
            { name: "Reviews", icon: MessageSquare },
            { name: "Profile & reports", icon: Download },
            { name: "Storage", icon: Database },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-pressed={tab === name}
              onClick={() => {
                setTab(name);
                setNotice("");
              }}
            >
              <Icon size={16} />
              {name}
            </button>
          ))}
        </nav>
        {offline && (
          <p role="status" className="offline-banner">
            Offline snapshot — reconnect and refresh before changing records.
            Video playback and analysis require the server.
          </p>
        )}
        {error && (
          <div className="feedback" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p role="status" className="success-feedback">
            {notice}
          </p>
        )}
        {loading ? (
          <p role="status">Loading training data…</p>
        ) : (
          <>
            {tab === "Wellness" && (
              <WellnessPanel
                entries={workspace.wellness ?? []}
                sessions={sessions}
                saving={saving}
                offline={offline}
                onSave={(entries) =>
                  persist({ ...state.current, wellness: entries })
                }
              />
            )}
            {tab === "Storage" && <StoragePanel />}
            {tab === "Practice" && (
              <PracticePanel
                workspace={workspace}
                sessions={sessions}
                saving={saving}
                offline={offline}
                onSave={persist}
              />
            )}
            {tab === "Teams" &&
              (supabaseConfigured() ? (
                <CoachTeamPanel sessions={sessions} />
              ) : (
                <section className="panel hub-panel">
                  <h2>Coach & team access</h2>
                  <p>
                    Configure Supabase Auth and apply the Phase 8 database
                    migration to enable verified coach invitations, teams,
                    timestamped feedback, assignments, and private messages.
                  </p>
                </section>
              ))}
            {tab === "Progress" && (
              <>
                <div className="overview-grid">
                  <div className="stat-card">
                    <div>
                      <span className="stat-label">Last seven days</span>
                      <div className="stat-value">
                        {thisWeek.length}
                        <span>
                          {new Set(thisWeek.map((s) => s.date)).size} practice
                          days · {thisWeek.reduce((n, s) => n + s.reps, 0)} reps
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div>
                      <span className="stat-label">Personal best success</span>
                      <div className="stat-value">
                        {best
                          ? successRate(best.makes, best.misses) + "%"
                          : "—"}
                        <span>
                          {best
                            ? `${best.name} · ${best.makes + best.misses} attempts`
                            : "Log attempts to track a best"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div>
                      <span className="stat-label">Most reps in a session</span>
                      <div className="stat-value">
                        {Math.max(0, ...sessions.map((s) => s.reps))}
                        <span>{sessions.length} total sessions</span>
                      </div>
                    </div>
                  </div>
                </div>
                <section className="panel hub-panel">
                  <h2>Daily training trend</h2>
                  <p className="muted">
                    Last 20 practice dates. Bars show repetitions; dots show
                    success percentage.
                  </p>
                  {recent.length ? (
                    <>
                      <svg
                        viewBox="0 0 800 220"
                        className="trend-chart"
                        role="img"
                        aria-label="Daily repetitions and success rate chart"
                      >
                        {recent.map((d, i) => {
                          const x = 20 + (i * 760) / recent.length,
                            w = 760 / recent.length;
                          return (
                            <g key={d.date}>
                              <rect
                                x={x}
                                y={190 - (d.reps / maxReps) * 160}
                                width={Math.max(3, w - 8)}
                                height={(d.reps / maxReps) * 160}
                                fill="#25753c"
                                rx="3"
                              >
                                <title>
                                  {d.date}: {d.reps} reps
                                </title>
                              </rect>
                              {d.rate !== null && (
                                <circle
                                  cx={x + (w - 8) / 2}
                                  cy={190 - d.rate * 1.6}
                                  r="5"
                                  fill="#08758a"
                                >
                                  <title>
                                    {d.date}: {d.rate}% success
                                  </title>
                                </circle>
                              )}
                              <text x={x} y="211" fontSize="10" fill="#53665c">
                                {d.date.slice(5)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Sessions</th>
                              <th>Reps</th>
                              <th>Success</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recent
                              .slice()
                              .reverse()
                              .map((d) => (
                                <tr key={d.date}>
                                  <td>{d.date}</td>
                                  <td>{d.sessions}</td>
                                  <td>{d.reps}</td>
                                  <td>
                                    {d.rate === null
                                      ? "No attempts"
                                      : d.rate + "%"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p>Save your first session to see progress.</p>
                  )}
                </section>
              </>
            )}
            {tab === "Plans & goals" && (
              <div className="hub-two-columns">
                <section className="panel hub-panel">
                  <h2>
                    <Target size={18} /> Practice goals
                  </h2>
                  <form
                    className="hub-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await persist({
                          ...state.current,
                          goals: [
                            ...state.current.goals,
                            { ...goal, id: crypto.randomUUID() },
                          ],
                        })
                      )
                        setGoal({ ...goal, name: "" });
                    }}
                  >
                    <fieldset disabled={saving}>
                      <label className="field-label">
                        Goal name
                        <input
                          required
                          maxLength={100}
                          value={goal.name}
                          onChange={(e) =>
                            setGoal({ ...goal, name: e.target.value })
                          }
                        />
                      </label>
                      <div className="hub-controls">
                        <label className="field-label">
                          Goal metric
                          <select
                            value={goal.metric}
                            onChange={(e) =>
                              setGoal({
                                ...goal,
                                metric: e.target.value as typeof goal.metric,
                                target: e.target.value === "success" ? 75 : 100,
                              })
                            }
                          >
                            <option value="reps">Total reps</option>
                            <option value="sessions">Session count</option>
                            <option value="success">Success percentage</option>
                          </select>
                        </label>
                        <label className="field-label">
                          Goal target
                          <input
                            type="number"
                            required
                            min="1"
                            max={goal.metric === "success" ? 100 : 100000}
                            value={goal.target}
                            onChange={(e) =>
                              setGoal({
                                ...goal,
                                target: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="hub-controls">
                        <label className="field-label">
                          Goal start
                          <input
                            type="date"
                            required
                            value={goal.from}
                            onChange={(e) =>
                              setGoal({ ...goal, from: e.target.value })
                            }
                          />
                        </label>
                        <label className="field-label">
                          Goal deadline
                          <input
                            type="date"
                            required
                            min={goal.from}
                            value={goal.to}
                            onChange={(e) =>
                              setGoal({ ...goal, to: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label className="field-label">
                        Goal tag
                        <select
                          value={goal.tag}
                          onChange={(e) =>
                            setGoal({ ...goal, tag: e.target.value })
                          }
                        >
                          <option value="">All drills</option>
                          {TAGS.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <button className="button-primary">Add goal</button>
                    </fieldset>
                  </form>
                  <div className="hub-list">
                    {workspace.goals.map((g) => {
                      const p = goalProgress(g, sessions);
                      return (
                        <article key={g.id}>
                          <h3>{g.name}</h3>
                          <p>
                            {p.value ?? "No attempts"} / {g.target}
                            {g.metric === "success"
                              ? "%"
                              : " " + g.metric} · {g.from} to {g.to}
                          </p>
                          <progress
                            aria-label={`${g.name} progress`}
                            max="100"
                            value={p.percent}
                          />
                          <button
                            disabled={saving}
                            className="text-link"
                            onClick={() => {
                              if (confirm(`Delete goal “${g.name}”?`))
                                void persist({
                                  ...state.current,
                                  goals: state.current.goals.filter(
                                    (x) => x.id !== g.id,
                                  ),
                                });
                            }}
                          >
                            Delete goal
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
                <section className="panel hub-panel">
                  <h2>
                    <CalendarDays size={18} /> Training schedule
                  </h2>
                  <form
                    className="hub-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await persist({
                          ...state.current,
                          plans: [
                            ...state.current.plans,
                            { ...plan, id: crypto.randomUUID(), done: false },
                          ],
                        })
                      )
                        setPlan({ ...plan, name: "" });
                    }}
                  >
                    <fieldset disabled={saving}>
                      <label className="field-label">
                        Planned drill
                        <input
                          required
                          maxLength={100}
                          value={plan.name}
                          onChange={(e) =>
                            setPlan({ ...plan, name: e.target.value })
                          }
                        />
                      </label>
                      <div className="hub-controls">
                        <label className="field-label">
                          Planned date
                          <input
                            type="date"
                            required
                            value={plan.date}
                            onChange={(e) =>
                              setPlan({ ...plan, date: e.target.value })
                            }
                          />
                        </label>
                        <label className="field-label">
                          Planned repetitions
                          <input
                            type="number"
                            required
                            min="1"
                            max="100000"
                            value={plan.target}
                            onChange={(e) =>
                              setPlan({
                                ...plan,
                                target: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="field-label">
                        Planned tag
                        <select
                          value={plan.tag}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              tag: e.target.value as typeof plan.tag,
                            })
                          }
                        >
                          {TAGS.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <button className="button-primary">Schedule drill</button>
                    </fieldset>
                  </form>
                  <div className="hub-list">
                    {workspace.plans
                      .slice()
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((p) => (
                        <article key={p.id}>
                          <label className="plan-check">
                            <input
                              type="checkbox"
                              aria-label={`Complete ${p.name}`}
                              checked={p.done}
                              disabled={saving}
                              onChange={() =>
                                void persist({
                                  ...state.current,
                                  plans: state.current.plans.map((x) =>
                                    x.id === p.id ? { ...x, done: !x.done } : x,
                                  ),
                                })
                              }
                            />
                            <strong>{p.name}</strong>
                          </label>
                          <p>
                            {p.date} · {p.target} reps · {p.tag}
                          </p>
                          <p
                            className={
                              p.date <= localDate() && !p.done
                                ? "due-label"
                                : "muted"
                            }
                          >
                            {p.done
                              ? "Completed"
                              : p.date < localDate()
                                ? "Overdue"
                                : p.date === localDate()
                                  ? "Due today"
                                  : "Upcoming"}
                          </p>
                          <button
                            disabled={saving}
                            className="text-link"
                            onClick={() => {
                              if (confirm(`Delete planned drill “${p.name}”?`))
                                void persist({
                                  ...state.current,
                                  plans: state.current.plans.filter(
                                    (x) => x.id !== p.id,
                                  ),
                                });
                            }}
                          >
                            Delete plan
                          </button>
                        </article>
                      ))}
                  </div>
                  <p className="muted">
                    Due reminders appear here when the app is open. Completing a
                    plan does not create a logged session.
                  </p>
                </section>
              </div>
            )}
            {(tab === "Movement" || tab === "Reviews") && (
              <label className="field-label hub-session-picker">
                Saved session
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="" disabled>
                    Select a session
                  </option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.date}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === "Movement" &&
              (current ? (
                <PoseReview
                  key={current.id + current.revision}
                  session={current}
                  analysis={workspace.analyses.find(
                    (a) => a.sessionId === current.id,
                  )}
                  customTemplates={workspace.analysisTemplates}
                  onSaveTemplate={saveAnalysisTemplate}
                  onSave={saveAnalysis}
                />
              ) : (
                <section className="panel hub-panel">
                  <p>Save a video session before analyzing movement.</p>
                  <Link className="text-link" href="/">
                    Go to video workspace
                  </Link>
                </section>
              ))}
            {tab === "Compare" && (
              <ClipComparison
                sessions={sessions}
                analyses={workspace.analyses}
              />
            )}
            {tab === "Reviews" && (
              <section className="panel hub-panel">
                <h2>Session review notes</h2>
                {current &&
                  (current.ownerId === ownerId ||
                    (ownerId === "local" && !current.ownerId)) && (
                    <SessionSharing session={current} />
                  )}
                {current && (
                  <button
                    className="button-ghost"
                    disabled={saving || offline}
                    onClick={() => void exportVideo()}
                  >
                    Export annotated MP4
                  </button>
                )}
                <p className="muted">
                  MP4 export burns in saved manual markup at its frame timing.
                  Up to 3 minutes and 1920px; pose skeletons are reviewed in the
                  Movement tab.
                </p>
                <p className="muted">
                  Local comments for this workspace. Author names are labels,
                  not verified accounts.
                </p>
                {current ? (
                  <>
                    <form
                      className="hub-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await persist({
                            ...state.current,
                            comments: [
                              ...state.current.comments,
                              {
                                id: crypto.randomUUID(),
                                sessionId: current.id,
                                author: workspace.profile.name,
                                text: comment,
                                createdAt: new Date().toISOString(),
                              },
                            ],
                          })
                        )
                          setComment("");
                      }}
                    >
                      <fieldset disabled={saving}>
                        <label className="field-label">
                          Review comment
                          <textarea
                            required
                            maxLength={2000}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                          />
                        </label>
                        <button className="button-primary">
                          Add review comment
                        </button>
                      </fieldset>
                    </form>
                    <div className="hub-list">
                      {workspace.comments
                        .filter((c) => c.sessionId === current.id)
                        .map((c) => (
                          <article key={c.id}>
                            <strong>{c.author}</strong>
                            <span className="muted">
                              {" "}
                              · {new Date(c.createdAt).toLocaleString()}
                            </span>
                            <p className="review-text">{c.text}</p>
                            <button
                              disabled={saving}
                              className="text-link"
                              onClick={() => {
                                if (confirm("Delete this review comment?"))
                                  void persist({
                                    ...state.current,
                                    comments: state.current.comments.filter(
                                      (x) => x.id !== c.id,
                                    ),
                                  });
                              }}
                            >
                              Delete comment
                            </button>
                          </article>
                        ))}
                    </div>
                  </>
                ) : (
                  <p>Save a session to add review comments.</p>
                )}
              </section>
            )}
            {tab === "Profile & reports" && (
              <div className="hub-two-columns">
                {supabaseConfigured() && <BillingPanel />}
                {supabaseConfigured() && <ReminderSettings />}
                <section className="panel hub-panel">
                  <h2>Athlete profile</h2>
                  <form
                    className="hub-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void persist({ ...state.current, profile });
                    }}
                  >
                    <fieldset disabled={saving}>
                      <label className="field-label">
                        Athlete name
                        <input
                          required
                          maxLength={80}
                          value={profile.name}
                          onChange={(e) =>
                            setProfile({ ...profile, name: e.target.value })
                          }
                        />
                      </label>
                      <label className="field-label">
                        Primary sport
                        <select
                          value={profile.sport}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              sport: e.target.value as typeof profile.sport,
                            })
                          }
                        >
                          {Object.keys(tips).map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <button className="button-primary">Save profile</button>
                    </fieldset>
                  </form>
                  <h3>{workspace.profile.sport} review guidance</h3>
                  <ul className="guidance-list">
                    {tips[workspace.profile.sport].map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </section>
                <section className="panel hub-panel">
                  <h2>Reports & data export</h2>
                  <p className="muted">
                    Export practice records or print a report using your
                    browser's Save as PDF option.
                  </p>
                  <div className="hub-controls">
                    <button
                      className="button-primary"
                      onClick={() =>
                        download(
                          "formsync-sessions.csv",
                          csvSessions(sessions),
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      Export sessions CSV
                    </button>
                    <button
                      className="button-ghost"
                      onClick={() =>
                        download(
                          "formsync-records.json",
                          JSON.stringify(
                            {
                              format: "formsync-records-v1",
                              exportedAt: new Date().toISOString(),
                              sessions,
                              workspace,
                            },
                            null,
                            2,
                          ),
                          "application/json",
                        )
                      }
                    >
                      Export records JSON
                    </button>
                    <Link
                      className="button-ghost"
                      href="/report"
                      target="_blank"
                    >
                      Printable progress report
                    </Link>
                  </div>
                  <p className="muted">
                    JSON contains logs, plans, comments, and pose data. Video
                    files are separate; back up the data directory for a full
                    backup.
                  </p>
                  <p>
                    Storage: local filesystem · {sessions.length} sessions ·{" "}
                    {workspace.analyses.length} saved analyses
                  </p>
                  <a href="/api/health" target="_blank" className="text-link">
                    Check storage health
                  </a>
                </section>
                <ActivityImporter
                  workspace={workspace}
                  offline={offline}
                  saving={saving}
                  onSave={(next) => persist(next)}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
