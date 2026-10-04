import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyProgress,
  goalProgress,
  emptyWorkspace,
  workspaceSchema,
  poseAngles,
  cameraVisibility,
  detectSquatRepetitions,
  interpolatePose,
  movementConfidence,
  movementVelocity,
  sportMovementMetrics,
  csvSessions,
  type Landmark,
} from "../lib/training";
import type { Session } from "../lib/model";
import { adaptivePracticeSuggestions } from "../lib/practice";
const base = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Drill",
  date: "2026-10-01",
  makes: 1,
  misses: 1,
  reps: 20,
  target: 30,
  notes: "",
  tags: ["Shooting"],
  fps: 30,
  drawings: [],
  videoId: "00000000-0000-4000-8000-000000000002",
  videoName: "clip.webm",
  videoType: "video/webm",
  createdAt: "2026-10-01T00:00:00Z",
} satisfies Session;
test("daily progress uses weighted outcomes rather than average session percentages", () => {
  const d = dailyProgress([base, { ...base, makes: 9, misses: 0, reps: 40 }]);
  assert.equal(d.length, 1);
  assert.equal(d[0].rate, 91);
  assert.equal(d[0].reps, 60);
  assert.equal(d[0].sessions, 2);
});
test("goals respect inclusive dates and drill tags and handle untracked outcomes", () => {
  const goal = {
    id: base.id,
    name: "Goal",
    metric: "reps" as const,
    target: 40,
    from: base.date,
    to: base.date,
    tag: "Shooting",
  };
  assert.deepEqual(
    goalProgress(goal, [base, { ...base, date: "2026-10-02" }]),
    { value: 20, percent: 50 },
  );
  assert.equal(goalProgress({ ...goal, tag: "Defense" }, [base]).value, 0);
  assert.equal(
    goalProgress({ ...goal, metric: "success" }, [
      { ...base, makes: 0, misses: 0 },
    ]).value,
    null,
  );
});
test("pose angles honor confidence and the source aspect ratio", () => {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 1,
  }));
  points[23] = { x: 0.1, y: 0.1, visibility: 1 };
  points[25] = { x: 0.5, y: 0.1, visibility: 1 };
  points[27] = { x: 0.5, y: 0.5, visibility: 1 };
  assert.equal(poseAngles(points, 640, 360)[0].angle, 90);
  points[25].visibility = 0.59;
  assert.equal(poseAngles(points, 640, 360)[0].angle, null);
});
test("pose analysis reports conservative camera visibility and confidence", () => {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.8,
  }));
  assert.equal(movementConfidence(landmarks), 80);
  const sample = { time: 0, landmarks };
  assert.deepEqual(cameraVisibility([sample]), {
    detectedPercent: 100,
    torsoPercent: 100,
    feetPercent: 100,
    warnings: [],
  });
  landmarks[27].visibility = 0.1;
  landmarks[28].visibility = 0.1;
  assert.match(cameraVisibility([sample]).warnings.join(" "), /Feet/);
  assert.match(cameraVisibility([]).warnings[0], /No person/);
});
test("pose interpolation and movement metrics use measured, ordered samples", () => {
  const first: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.2,
    y: 0.4,
    visibility: 0.8,
  }));
  const second = first.map((point) => ({
    x: 0.8,
    y: 0.6,
    visibility: 1,
  }));
  const interpolated = interpolatePose(
    [
      { time: 0, landmarks: first },
      { time: 2, landmarks: second },
    ],
    1,
  );
  assert.equal(interpolated?.landmarks[25].x, 0.5);
  assert.equal(interpolated?.landmarks[25].visibility, 0.9);
  const series = [
    { time: 0, angle: 170 },
    { time: 1, angle: 100 },
    { time: 2, angle: 90 },
    { time: 3, angle: 170 },
    { time: 4, angle: 100 },
    { time: 5, angle: 170 },
  ];
  assert.deepEqual(detectSquatRepetitions(series, 105, 160), [3, 5]);
  assert.deepEqual(movementVelocity(series), { average: 60, peak: 80 });
});
test("sport analysis reports manual release-angle proxies and marked phase measurements", () => {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  landmarks[12] = { x: 0.3, y: 0.5, visibility: 1 };
  landmarks[14] = { x: 0.5, y: 0.5, visibility: 1 };
  landmarks[16] = { x: 0.6, y: 0.3, visibility: 1 };
  const metrics = sportMovementMetrics(
    "basketball-shot",
    "Right elbow",
    [
      { time: 1, landmarks },
      { time: 2, landmarks },
    ],
    [
      { phase: "release", time: 1 },
      { phase: "release", time: 2 },
    ],
    640,
    360,
  );
  assert.deepEqual(metrics.releaseAngles, [48.4, 48.4]);
  assert.equal(metrics.releaseAngleDeviation, 0);
  assert.ok(Math.abs(metrics.markedPhases[0].angle! - 131.6) < 0.1);
});
test("adaptive practice suggestions only react to recorded session ratings", () => {
  assert.match(
    adaptivePracticeSuggestions([], [], "2026-10-04")[0],
    /Record a practice session/,
  );
  const suggestions = adaptivePracticeSuggestions(
    [base],
    [
      {
        id: base.id,
        workoutId: base.id,
        completedAt: "2026-10-04T12:00:00.000Z",
        completedSets: [3],
        effort: 9,
        fatigue: 5,
      },
    ],
    "2026-10-04",
  );
  assert.match(suggestions.join(" "), /high effort or fatigue/);
});
test("workspace rejects impossible dates, reversed goals and success over 100", () => {
  const w = emptyWorkspace();
  const g = {
    id: base.id,
    name: "Goal",
    metric: "success",
    target: 101,
    from: "2026-10-01",
    to: "2026-10-02",
    tag: "",
  };
  assert.equal(workspaceSchema.safeParse({ ...w, goals: [g] }).success, false);
  assert.equal(
    workspaceSchema.safeParse({
      ...w,
      goals: [{ ...g, target: 50, to: "2026-09-30" }],
    }).success,
    false,
  );
  assert.equal(
    workspaceSchema.safeParse({
      ...w,
      plans: [
        {
          id: base.id,
          name: "Drill",
          date: "2026-02-30",
          target: 10,
          tag: "Shooting",
          done: false,
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    workspaceSchema.safeParse({
      ...w,
      workouts: [
        {
          id: base.id,
          name: "Invalid workout",
          items: [
            {
              id: base.videoId,
              drillId: "builtin-form-shooting",
              name: "Form shooting",
              sets: 0,
              reps: 10,
              restSeconds: 30,
            },
          ],
        },
      ],
    }).success,
    false,
  );
});
test("CSV quotes text and neutralizes spreadsheet formulas", () => {
  const csv = csvSessions([
    { ...base, name: '=HYPERLINK("bad")', notes: "line 1\nline 2" },
  ]);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"line 1\nline 2"/);
});
