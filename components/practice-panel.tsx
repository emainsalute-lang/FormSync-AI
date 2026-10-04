"use client";

import { useEffect, useMemo, useState } from "react";
import { localDate, TAGS, type Session } from "@/lib/model";
import {
  BUILTIN_DRILLS,
  WORKOUT_PLAN_TEMPLATES,
  adaptivePracticeSuggestions,
} from "@/lib/practice";
import type { Workspace } from "@/lib/training";
import { workoutsToCalendar } from "@/lib/calendar-export";
import CalendarFeedSettings from "./calendar-feed-settings";

type Props = {
  workspace: Workspace;
  sessions: Session[];
  saving: boolean;
  offline: boolean;
  onSave: (workspace: Workspace) => Promise<boolean>;
};
type WorkoutItem = Workspace["workouts"][number]["items"][number];
type DrillTag = Workspace["drills"][number]["tag"];
const builtinDrills = BUILTIN_DRILLS;
export default function PracticePanel({
  workspace,
  sessions,
  saving,
  offline,
  onSave,
}: Props) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("All drills");
  const [drillName, setDrillName] = useState("");
  const [drillTag, setDrillTag] = useState<DrillTag>("Shooting");
  const [instructions, setInstructions] = useState("");
  const [demoSession, setDemoSession] = useState("");
  const [workoutName, setWorkoutName] = useState("");
  const [draftItems, setDraftItems] = useState<WorkoutItem[]>([]);
  const [selectedDrill, setSelectedDrill] = useState("");
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const [restSeconds, setRestSeconds] = useState(60);
  const [scheduleWorkout, setScheduleWorkout] = useState("");
  const [scheduleDate, setScheduleDate] = useState(localDate());
  const [calendarWeek, setCalendarWeek] = useState(localDate());
  const [activeWorkoutId, setActiveWorkoutId] = useState("");
  const [completedSets, setCompletedSets] = useState<number[]>([]);
  const [effort, setEffort] = useState(5);
  const [fatigue, setFatigue] = useState(3);
  const [restRemaining, setRestRemaining] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!restRemaining) return;
    const timer = window.setTimeout(
      () => setRestRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [restRemaining]);

  const drills = useMemo(
    () => [...builtinDrills, ...workspace.drills],
    [workspace.drills],
  );
  const visibleDrills = drills.filter((drill) => {
    const text =
      `${drill.name} ${drill.instructions} ${drill.tag}`.toLowerCase();
    return (
      (tagFilter === "All drills" || drill.tag === tagFilter) &&
      text.includes(query.toLowerCase().trim())
    );
  });
  const activeWorkout = workspace.workouts.find(
    (workout) => workout.id === activeWorkoutId,
  );
  const suggestions = adaptivePracticeSuggestions(
    sessions,
    workspace.workoutLogs,
    localDate(),
  );
  const byId = (drillId: string) =>
    drills.find((drill) => drill.id === drillId);

  async function createDrill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextDrill = {
      id: crypto.randomUUID(),
      name: drillName.trim(),
      tag: drillTag,
      instructions: instructions.trim(),
      demonstrationSessionId: demoSession || null,
    };
    if (!nextDrill.name || !nextDrill.instructions) return;
    if (
      await onSave({ ...workspace, drills: [...workspace.drills, nextDrill] })
    ) {
      setDrillName("");
      setInstructions("");
      setDemoSession("");
      setNotice("Custom drill saved.");
    }
  }

  function addWorkoutItem() {
    const drill = byId(selectedDrill);
    if (!drill) return;
    setDraftItems((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        drillId: drill.id,
        name: drill.name,
        sets,
        reps,
        restSeconds,
      },
    ]);
  }

  async function saveWorkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workoutName.trim();
    if (!name || !draftItems.length) return;
    const workout = { id: crypto.randomUUID(), name, items: draftItems };
    if (
      await onSave({ ...workspace, workouts: [...workspace.workouts, workout] })
    ) {
      setWorkoutName("");
      setDraftItems([]);
      setNotice("Workout template saved.");
    }
  }

  async function addPlanTemplate(
    templateName: string,
    drillIds: readonly string[],
  ) {
    const items = drillIds.flatMap((drillId) => {
      const drill = byId(drillId);
      return drill
        ? [
            {
              id: crypto.randomUUID(),
              drillId,
              name: drill.name,
              sets: 3,
              reps: 10,
              restSeconds: 60,
            },
          ]
        : [];
    });
    if (!items.length) return;
    if (
      await onSave({
        ...workspace,
        workouts: [
          ...workspace.workouts,
          { id: crypto.randomUUID(), name: templateName, items },
        ],
      })
    ) {
      setNotice(`${templateName} added to your workout templates.`);
    }
  }

  async function scheduleSelectedWorkout(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const workout = workspace.workouts.find(
      (item) => item.id === scheduleWorkout,
    );
    if (!workout) return;
    const firstDrill = byId(workout.items[0].drillId);
    const target = workout.items.reduce(
      (sum, item) => sum + item.sets * item.reps,
      0,
    );
    if (
      await onSave({
        ...workspace,
        plans: [
          ...workspace.plans,
          {
            id: crypto.randomUUID(),
            name: workout.name,
            date: scheduleDate,
            target,
            tag: firstDrill?.tag || "Footwork",
            workoutId: workout.id,
            done: false,
          },
        ],
      })
    ) {
      setNotice("Workout added to the practice calendar.");
    }
  }

  async function finishWorkout() {
    if (!activeWorkout) return;
    const today = localDate();
    const log: Workspace["workoutLogs"][number] = {
      id: crypto.randomUUID(),
      workoutId: activeWorkout.id,
      completedAt: new Date().toISOString(),
      completedSets,
      effort,
      fatigue,
    };
    const saved = await onSave({
      ...workspace,
      workoutLogs: [...workspace.workoutLogs, log],
      plans: workspace.plans.map((plan) =>
        plan.workoutId === activeWorkout.id && plan.date === today
          ? { ...plan, done: true }
          : plan,
      ),
    });
    if (saved) {
      setActiveWorkoutId("");
      setRestRemaining(0);
      setNotice("Workout log saved with effort and fatigue ratings.");
    }
  }

  const weekStartDate = new Date(calendarWeek + "T00:00:00Z");
  const mondayOffset = (weekStartDate.getUTCDay() + 6) % 7;
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - mondayOffset);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);
  const scheduled = workspace.plans
    .filter(
      (plan) =>
        plan.workoutId && plan.date >= weekStart && plan.date <= weekEnd,
    )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const trackedLogs = workspace.workoutLogs
    .slice()
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, 10);

  return (
    <div className="practice-panel">
      <section className="panel hub-panel">
        <h2>Practice suggestions</h2>
        <p className="muted">
          Rule-based prompts from saved sessions and workout ratings. These are
          not coaching or medical advice.
        </p>
        <ul className="practice-suggestions">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </section>

      <section className="panel hub-panel">
        <h2>Drill library</h2>
        <p className="muted">
          Search built-in drills or add drills with your own instructions and a
          saved-session demonstration clip.
        </p>
        <div className="hub-controls">
          <label className="field-label">
            Search drills
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="field-label">
            Filter by tag
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option>All drills</option>
              {TAGS.map((tag) => (
                <option key={tag}>{tag}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="hub-list">
          {visibleDrills.map((drill) => {
            const demonstration = sessions.find(
              (session) => session.id === drill.demonstrationSessionId,
            );
            return (
              <article key={drill.id}>
                <h3>{drill.name}</h3>
                <p className="muted">{drill.tag}</p>
                <p>{drill.instructions}</p>
                {demonstration && (
                  <a
                    className="text-link"
                    href={`/api/videos/${demonstration.videoId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Play demonstration clip: {demonstration.name}
                  </a>
                )}
              </article>
            );
          })}
          {!visibleDrills.length && <p>No drills match this search.</p>}
        </div>
        <form
          className="hub-form"
          onSubmit={(event) => void createDrill(event)}
        >
          <fieldset disabled={saving || offline}>
            <h3>Create a custom drill</h3>
            <label className="field-label">
              Drill name
              <input
                required
                maxLength={100}
                value={drillName}
                onChange={(event) => setDrillName(event.target.value)}
              />
            </label>
            <label className="field-label">
              Drill instructions
              <textarea
                required
                maxLength={3000}
                rows={3}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
            <div className="hub-controls">
              <label className="field-label">
                Drill tag
                <select
                  value={drillTag}
                  onChange={(event) =>
                    setDrillTag(event.target.value as DrillTag)
                  }
                >
                  {TAGS.map((tag) => (
                    <option key={tag}>{tag}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Demonstration clip (optional)
                <select
                  value={demoSession}
                  onChange={(event) => setDemoSession(event.target.value)}
                >
                  <option value="">No demonstration clip</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="button-primary">Save custom drill</button>
          </fieldset>
        </form>
      </section>

      <section className="panel hub-panel">
        <h2>Workout builder</h2>
        <div className="hub-controls">
          {WORKOUT_PLAN_TEMPLATES.map((template) => (
            <button
              key={template.name}
              type="button"
              className="button-ghost"
              disabled={saving || offline}
              onClick={() =>
                void addPlanTemplate(template.name, template.drillIds)
              }
            >
              Use {template.name} template
            </button>
          ))}
        </div>
        <form
          className="hub-form"
          onSubmit={(event) => void saveWorkout(event)}
        >
          <fieldset disabled={saving || offline}>
            <label className="field-label">
              Workout name
              <input
                required
                maxLength={100}
                value={workoutName}
                onChange={(event) => setWorkoutName(event.target.value)}
              />
            </label>
            <div className="hub-controls">
              <label className="field-label">
                Drill
                <select
                  value={selectedDrill}
                  onChange={(event) => setSelectedDrill(event.target.value)}
                >
                  <option value="">Choose a drill</option>
                  {drills.map((drill) => (
                    <option key={drill.id} value={drill.id}>
                      {drill.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Sets
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={sets}
                  onChange={(event) => setSets(Number(event.target.value))}
                />
              </label>
              <label className="field-label">
                Reps per set
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={reps}
                  onChange={(event) => setReps(Number(event.target.value))}
                />
              </label>
              <label className="field-label">
                Rest seconds
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={restSeconds}
                  onChange={(event) =>
                    setRestSeconds(Number(event.target.value))
                  }
                />
              </label>
              <button
                type="button"
                className="button-ghost"
                disabled={!selectedDrill}
                onClick={addWorkoutItem}
              >
                Add drill to workout
              </button>
            </div>
            {draftItems.map((item, index) => (
              <div className="practice-draft-item" key={item.id}>
                <span>
                  {index + 1}. {item.name} · {item.sets} × {item.reps} ·{" "}
                  {item.restSeconds}s rest
                </span>
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    setDraftItems((items) =>
                      items.filter((draft) => draft.id !== item.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="button-primary"
              disabled={!workoutName.trim() || !draftItems.length}
            >
              Save workout template
            </button>
          </fieldset>
        </form>
        <div className="hub-list">
          {workspace.workouts.map((workout) => (
            <article key={workout.id}>
              <h3>{workout.name}</h3>
              <ul>
                {workout.items.map((item) => (
                  <li key={item.id}>
                    {item.name}: {item.sets} × {item.reps} · {item.restSeconds}s
                    rest
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {!workspace.workouts.length && <p>Save a workout to get started.</p>}
        </div>
      </section>

      <section className="panel hub-panel">
        <h2>Weekly workout calendar</h2>
        <CalendarFeedSettings />
        <button
          type="button"
          className="button-ghost"
          disabled={!workspace.plans.length}
          onClick={() => {
            const blob = new Blob([workoutsToCalendar(workspace.plans)], {
              type: "text/calendar;charset=utf-8",
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "formsync-training-calendar.ics";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Sync calendar (.ics)
        </button>
        <div className="hub-controls">
          <button
            type="button"
            className="button-ghost"
            aria-label="Previous week"
            onClick={() => {
              const date = new Date(weekStart + "T00:00:00Z");
              date.setUTCDate(date.getUTCDate() - 7);
              setCalendarWeek(date.toISOString().slice(0, 10));
            }}
          >
            Previous week
          </button>
          <p className="muted">
            {weekStart} to {weekEnd}
          </p>
          <button
            type="button"
            className="button-ghost"
            aria-label="Next week"
            onClick={() => {
              const date = new Date(weekStart + "T00:00:00Z");
              date.setUTCDate(date.getUTCDate() + 7);
              setCalendarWeek(date.toISOString().slice(0, 10));
            }}
          >
            Next week
          </button>
        </div>
        <form
          className="hub-form"
          onSubmit={(event) => void scheduleSelectedWorkout(event)}
        >
          <fieldset disabled={saving || offline || !workspace.workouts.length}>
            <div className="hub-controls">
              <label className="field-label">
                Workout
                <select
                  required
                  value={scheduleWorkout}
                  onChange={(event) => setScheduleWorkout(event.target.value)}
                >
                  <option value="">Choose a workout</option>
                  {workspace.workouts.map((workout) => (
                    <option key={workout.id} value={workout.id}>
                      {workout.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Practice date
                <input
                  type="date"
                  required
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </label>
            </div>
            <button className="button-primary">Schedule workout</button>
          </fieldset>
        </form>
        <div className="hub-list">
          {scheduled.map((plan) => (
            <article key={plan.id}>
              <h3>{plan.name}</h3>
              <p>
                {plan.date} · {plan.done ? "Completed" : "Planned"}
              </p>
            </article>
          ))}
          {!scheduled.length && <p>No workouts scheduled for this week.</p>}
        </div>
      </section>

      <section className="panel hub-panel">
        <h2>Set tracking and rest timer</h2>
        {!activeWorkout ? (
          <div className="hub-list">
            {workspace.workouts.map((workout) => (
              <article key={workout.id}>
                <h3>{workout.name}</h3>
                <button
                  className="button-primary"
                  disabled={offline}
                  onClick={() => {
                    setActiveWorkoutId(workout.id);
                    setCompletedSets(workout.items.map(() => 0));
                    setEffort(5);
                    setFatigue(3);
                  }}
                >
                  Start workout
                </button>
              </article>
            ))}
            {!workspace.workouts.length && <p>Build a workout first.</p>}
          </div>
        ) : (
          <div className="active-workout">
            <h3>{activeWorkout.name}</h3>
            <div className="hub-list">
              {activeWorkout.items.map((item, index) => (
                <article key={item.id}>
                  <h4>{item.name}</h4>
                  <p>
                    Set {completedSets[index] || 0} of {item.sets} · {item.reps}{" "}
                    reps each
                  </p>
                  <button
                    type="button"
                    className="button-ghost"
                    disabled={(completedSets[index] || 0) >= item.sets}
                    onClick={() => {
                      setCompletedSets((values) =>
                        values.map((count, itemIndex) =>
                          itemIndex === index ? count + 1 : count,
                        ),
                      );
                      setRestRemaining(item.restSeconds);
                    }}
                  >
                    Complete set
                  </button>
                </article>
              ))}
            </div>
            <div className="rest-timer" role="timer" aria-live="polite">
              Rest:{" "}
              {Math.floor(restRemaining / 60)
                .toString()
                .padStart(2, "0")}
              :{(restRemaining % 60).toString().padStart(2, "0")}
              <button
                type="button"
                className="button-ghost"
                onClick={() => setRestRemaining(0)}
              >
                Skip rest
              </button>
            </div>
            <div className="hub-controls">
              <label className="field-label">
                Session effort (0–10)
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={effort}
                  onChange={(event) => setEffort(Number(event.target.value))}
                />
              </label>
              <label className="field-label">
                Fatigue rating (1–5)
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={fatigue}
                  onChange={(event) => setFatigue(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="hub-controls">
              <button
                className="button-primary"
                disabled={saving}
                onClick={() => void finishWorkout()}
              >
                Save workout log
              </button>
              <button
                className="button-ghost"
                onClick={() => {
                  setActiveWorkoutId("");
                  setRestRemaining(0);
                }}
              >
                Cancel workout
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel hub-panel">
        <h2>Recent workout logs</h2>
        <div className="hub-list">
          {trackedLogs.map((log) => (
            <article key={log.id}>
              <h3>
                {workspace.workouts.find(
                  (workout) => workout.id === log.workoutId,
                )?.name || "Workout"}
              </h3>
              <p>
                {new Date(log.completedAt).toLocaleDateString()} · effort{" "}
                {log.effort}/10 · fatigue {log.fatigue}/5 ·{" "}
                {log.completedSets.reduce((sum, count) => sum + count, 0)} sets
              </p>
            </article>
          ))}
          {!trackedLogs.length && (
            <p>Finish a workout to build your history.</p>
          )}
        </div>
      </section>
      {notice && (
        <p role="status" className="success-feedback">
          {notice}
        </p>
      )}
    </div>
  );
}
