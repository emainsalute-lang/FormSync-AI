import { wellnessHistorySchema } from "./wellness";
import { z } from "zod";
import {
  jointAngle,
  successRate,
  calculateSessionLoad,
  type Session,
} from "./model";
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");
const id = z.string().uuid();
const movementPhase = z.enum([
  "set",
  "windup",
  "takeoff",
  "plant",
  "release",
  "contact",
  "landing",
  "follow-through",
  "transition",
]);
const jointName = z.enum([
  "Left knee",
  "Right knee",
  "Left elbow",
  "Right elbow",
  "Left hip",
  "Right hip",
]);
export const landmarkSchema = z.object({
  x: z.number().finite().min(-5).max(5),
  y: z.number().finite().min(-5).max(5),
  visibility: z.number().min(0).max(1),
});
export const analysisSchema = z.object({
  sessionId: id,
  videoId: id,
  sessionRevision: z.string().max(100),
  createdAt: z.string().datetime(),
  samples: z
    .array(
      z.object({
        time: z.number().min(0).max(1800),
        landmarks: z.array(landmarkSchema).length(33),
      }),
    )
    .max(300),
  sampledFrames: z.number().int().min(1).max(300),
  phases: z
    .array(
      z.object({
        phase: movementPhase,
        time: z.number().finite().min(0).max(1800),
      }),
    )
    .max(60)
    .default([]),
});
const drillTag = z.enum([
  "Shooting",
  "Speed",
  "Plyometrics",
  "Defense",
  "Strength",
  "Footwork",
]);
const workoutItemSchema = z.object({
  id,
  drillId: z.string().max(80),
  name: z.string().trim().min(1).max(100),
  sets: z.number().int().min(1).max(30),
  reps: z.number().int().min(1).max(1000),
  restSeconds: z.number().int().min(0).max(3600),
});
export const workspaceSchema = z.object({
  version: z.literal(1),
  revision: z.string().max(100),
  profile: z.object({
    name: z.string().trim().min(1).max(80),
    sport: z.enum(["Basketball", "Running", "Strength", "General"]),
  }),
  goals: z
    .array(
      z
        .object({
          id,
          name: z.string().trim().min(1).max(100),
          metric: z.enum(["reps", "sessions", "success"]),
          target: z.number().min(1).max(100000),
          from: day,
          to: day,
          tag: z.string().max(40),
        })
        .refine((g) => g.to >= g.from, "Goal end precedes start")
        .refine(
          (g) => g.metric !== "success" || g.target <= 100,
          "Success targets cannot exceed 100%",
        ),
    )
    .max(100),
  plans: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(100),
        date: day,
        target: z.number().int().min(1).max(100000),
        tag: drillTag,
        workoutId: id.optional(),
        done: z.boolean(),
      }),
    )
    .max(300),
  drills: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(100),
        tag: drillTag,
        instructions: z.string().trim().min(1).max(3000),
        demonstrationSessionId: id.nullable(),
      }),
    )
    .max(200)
    .default([]),
  workouts: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(100),
        items: z.array(workoutItemSchema).min(1).max(40),
      }),
    )
    .max(100)
    .default([]),
  workoutLogs: z
    .array(
      z.object({
        id,
        workoutId: id,
        completedAt: z.string().datetime(),
        completedSets: z.array(z.number().int().min(0).max(30)).max(40),
        effort: z.number().int().min(0).max(10),
        fatigue: z.number().int().min(1).max(5),
      }),
    )
    .max(1000)
    .default([]),
  wearableActivities: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(100),
        source: z.enum(["TCX", "GPX", "CSV"]),
        startedAt: z.string().datetime().nullable(),
        durationSeconds: z
          .number()
          .finite()
          .min(0)
          .max(7 * 86400)
          .nullable(),
        distanceMeters: z.number().finite().min(0).max(10_000_000).nullable(),
        calories: z.number().finite().min(0).max(100_000).nullable(),
        averageHeartRate: z.number().int().min(20).max(250).nullable(),
        importedAt: z.string().datetime(),
      }),
    )
    .max(1000)
    .default([]),
  comments: z
    .array(
      z.object({
        id,
        sessionId: id,
        author: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(2000),
        createdAt: z.string().datetime(),
      }),
    )
    .max(500),
  analyses: z.array(analysisSchema).max(100),
  analysisTemplates: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(60),
        joint: jointName,
        phases: z.array(movementPhase).min(1).max(9),
      }),
    )
    .max(50)
    .default([]),
  wellness: wellnessHistorySchema.default([]),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type PoseAnalysis = z.infer<typeof analysisSchema>;
export type Landmark = z.infer<typeof landmarkSchema>;
export const SPORT_ANALYSIS_TEMPLATES = [
  {
    id: "basketball-shot",
    name: "Basketball shooting",
    joint: "Right elbow",
    phases: ["set", "release", "follow-through"],
    description:
      "Track elbow extension and mark release events; forearm orientation is a 2D release-angle proxy, not ball trajectory.",
  },
  {
    id: "squat",
    name: "Squat depth",
    joint: "Left knee",
    phases: ["set", "landing", "follow-through"],
    description:
      "Review knee-angle range and estimated depth. Repeat counts depend on your selected thresholds.",
  },
  {
    id: "lunge",
    name: "Lunge",
    joint: "Left knee",
    phases: ["set", "landing", "follow-through"],
    description:
      "Track left/right knee angles at manually marked lunge phases.",
  },
  {
    id: "jump",
    name: "Jump takeoff and landing",
    joint: "Left knee",
    phases: ["set", "takeoff", "landing"],
    description:
      "Compare knee angles at marked takeoff and landing; this does not measure force or impact.",
  },
  {
    id: "sprint",
    name: "Sprint stride timing",
    joint: "Left knee",
    phases: ["plant", "takeoff"],
    description:
      "Estimate repeated knee-angle cycles and their timing from sampled frames.",
  },
  {
    id: "footwork",
    name: "Footwork rhythm",
    joint: "Left knee",
    phases: ["set", "transition", "landing"],
    description:
      "Estimate movement-cycle timing; ladder contacts are not detected from video.",
  },
  {
    id: "tennis-serve",
    name: "Tennis serve",
    joint: "Right elbow",
    phases: ["set", "windup", "contact", "follow-through"],
    description:
      "Mark serve phases manually and review elbow-angle changes at those times.",
  },
] as const;
export type SportAnalysisTemplate =
  (typeof SPORT_ANALYSIS_TEMPLATES)[number]["id"] | "custom";
export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    revision: "",
    profile: { name: "Athlete", sport: "General" },
    goals: [],
    plans: [],
    drills: [],
    workouts: [],
    workoutLogs: [],
    wearableActivities: [],
    comments: [],
    analyses: [],
    analysisTemplates: [],
    wellness: [],
  };
}
export function goalProgress(
  goal: Workspace["goals"][number],
  sessions: Session[],
) {
  const matching = sessions.filter(
    (s) =>
      s.date >= goal.from &&
      s.date <= goal.to &&
      (!goal.tag || s.tags.includes(goal.tag)),
  );
  const value =
    goal.metric === "sessions"
      ? matching.length
      : goal.metric === "reps"
        ? matching.reduce((n, s) => n + s.reps, 0)
        : successRate(
            matching.reduce((n, s) => n + s.makes, 0),
            matching.reduce((n, s) => n + s.misses, 0),
          );
  return {
    value,
    percent:
      value === null
        ? 0
        : Math.min(100, Math.round((value / goal.target) * 100)),
  };
}
export function dailyProgress(sessions: Session[]) {
  const days = new Map<
    string,
    {
      date: string;
      reps: number;
      makes: number;
      misses: number;
      sessions: number;
    }
  >();
  for (const s of sessions) {
    const row = days.get(s.date) || {
      date: s.date,
      reps: 0,
      makes: 0,
      misses: 0,
      sessions: 0,
    };
    row.reps += s.reps;
    row.makes += s.makes;
    row.misses += s.misses;
    row.sessions++;
    days.set(s.date, row);
  }
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, rate: successRate(d.makes, d.misses) }));
}
export const JOINTS = {
  "Left knee": [23, 25, 27],
  "Right knee": [24, 26, 28],
  "Left elbow": [11, 13, 15],
  "Right elbow": [12, 14, 16],
  "Left hip": [11, 23, 25],
  "Right hip": [12, 24, 26],
} as const;
export const CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];
export function poseAngles(
  landmarks: Landmark[],
  width: number,
  height: number,
) {
  return Object.entries(JOINTS).map(([name, indices]) => ({
    name,
    angle: indices.every((i) => landmarks[i]?.visibility >= 0.6)
      ? jointAngle(
          indices.map((i) => landmarks[i]),
          width,
          height,
        )
      : null,
  }));
}
export const CORRECTABLE_LANDMARKS = [
  { index: 0, name: "Nose" },
  { index: 11, name: "Left shoulder" },
  { index: 12, name: "Right shoulder" },
  { index: 13, name: "Left elbow" },
  { index: 14, name: "Right elbow" },
  { index: 15, name: "Left wrist" },
  { index: 16, name: "Right wrist" },
  { index: 23, name: "Left hip" },
  { index: 24, name: "Right hip" },
  { index: 25, name: "Left knee" },
  { index: 26, name: "Right knee" },
  { index: 27, name: "Left ankle" },
  { index: 28, name: "Right ankle" },
  { index: 31, name: "Left foot" },
  { index: 32, name: "Right foot" },
] as const;
export function interpolatePose(
  samples: PoseAnalysis["samples"],
  time: number,
) {
  if (!samples.length) return undefined;
  let right = samples.findIndex((sample) => sample.time >= time);
  if (right < 0) return samples[samples.length - 1];
  if (right === 0 || samples[right].time === time) return samples[right];
  const leftSample = samples[right - 1];
  const rightSample = samples[right];
  const fraction =
    (time - leftSample.time) / (rightSample.time - leftSample.time);
  return {
    time,
    landmarks: leftSample.landmarks.map((left, index) => {
      const rightPoint = rightSample.landmarks[index];
      return {
        x: left.x + (rightPoint.x - left.x) * fraction,
        y: left.y + (rightPoint.y - left.y) * fraction,
        visibility:
          left.visibility +
          (rightPoint.visibility - left.visibility) * fraction,
      };
    }),
  };
}
export function movementConfidence(landmarks: Landmark[]) {
  if (!landmarks.length) return 0;
  return Math.round(
    (landmarks.reduce((sum, point) => sum + point.visibility, 0) /
      landmarks.length) *
      100,
  );
}
export function cameraVisibility(samples: PoseAnalysis["samples"]) {
  if (!samples.length)
    return {
      detectedPercent: 0,
      torsoPercent: 0,
      feetPercent: 0,
      warnings: ["No person detected in the sampled frames."],
    };
  const rate = (indices: number[]) =>
    Math.round(
      (samples.filter((sample) =>
        indices.every((index) => sample.landmarks[index]?.visibility >= 0.6),
      ).length /
        samples.length) *
        100,
    );
  const detectedPercent = Math.round(
    (samples.filter(
      (sample) =>
        sample.landmarks.filter((point) => point.visibility >= 0.6).length >=
        12,
    ).length /
      samples.length) *
      100,
  );
  const torsoPercent = rate([11, 12, 23, 24]);
  const feetPercent = rate([27, 28]);
  const warnings: string[] = [];
  if (detectedPercent < 70)
    warnings.push(
      "Pose detection is inconsistent; improve lighting and keep one athlete in view.",
    );
  if (torsoPercent < 70)
    warnings.push(
      "Shoulders or hips are often obscured; reposition the camera.",
    );
  if (feetPercent < 70)
    warnings.push(
      "Feet are often obscured or outside the frame; include the full body.",
    );
  return { detectedPercent, torsoPercent, feetPercent, warnings };
}
export type AngleSample = { time: number; angle: number };
export function sportMovementMetrics(
  template: SportAnalysisTemplate,
  joint: keyof typeof JOINTS,
  samples: PoseAnalysis["samples"],
  phases: PoseAnalysis["phases"],
  width: number,
  height: number,
) {
  const series = samples.flatMap((sample) => {
    const angle =
      poseAngles(sample.landmarks, width, height).find(
        (entry) => entry.name === joint,
      )?.angle ?? null;
    return angle === null ? [] : [{ time: sample.time, angle }];
  });
  const angles = series.map((sample) => sample.angle);
  const minima = series.filter(
    (sample, index) =>
      index > 0 &&
      index < series.length - 1 &&
      sample.angle <= series[index - 1].angle &&
      sample.angle < series[index + 1].angle,
  );
  const cycleIntervals = minima
    .slice(1)
    .map((sample, index) =>
      Number((sample.time - minima[index].time).toFixed(2)),
    );
  const markedPhases = phases
    .filter((phase) =>
      template === "custom"
        ? true
        : (
            SPORT_ANALYSIS_TEMPLATES.find((item) => item.id === template)
              ?.phases as readonly string[] | undefined
          )?.includes(phase.phase),
    )
    .map((phase) => {
      const sample = samples.reduce(
        (nearest, candidate) =>
          Math.abs(candidate.time - phase.time) <
          Math.abs(nearest.time - phase.time)
            ? candidate
            : nearest,
        samples[0],
      );
      const angle = sample
        ? (poseAngles(sample.landmarks, width, height).find(
            (entry) => entry.name === joint,
          )?.angle ?? null)
        : null;
      const wrist = sample?.landmarks[16];
      const elbow = sample?.landmarks[14];
      const releaseAngle =
        template === "basketball-shot" &&
        phase.phase === "release" &&
        wrist?.visibility >= 0.6 &&
        elbow?.visibility >= 0.6
          ? Number(
              (
                (Math.atan2(
                  (elbow.y - wrist.y) * height,
                  (wrist.x - elbow.x) * width,
                ) *
                  180) /
                Math.PI
              ).toFixed(1),
            )
          : null;
      return { ...phase, angle, releaseAngle };
    });
  const releaseAngles = markedPhases.flatMap((phase) =>
    phase.releaseAngle === null ? [] : [phase.releaseAngle],
  );
  const meanReleaseAngle = releaseAngles.length
    ? releaseAngles.reduce((sum, value) => sum + value, 0) /
      releaseAngles.length
    : null;
  const releaseAngleDeviation =
    meanReleaseAngle === null || releaseAngles.length < 2
      ? null
      : Math.sqrt(
          releaseAngles.reduce(
            (sum, value) => sum + (value - meanReleaseAngle) ** 2,
            0,
          ) / releaseAngles.length,
        );
  return {
    series,
    meanAngle: angles.length
      ? Number(
          (
            angles.reduce((sum, value) => sum + value, 0) / angles.length
          ).toFixed(1),
        )
      : null,
    minAngle: angles.length ? Number(Math.min(...angles).toFixed(1)) : null,
    maxAngle: angles.length ? Number(Math.max(...angles).toFixed(1)) : null,
    range:
      angles.length > 0
        ? Number((Math.max(...angles) - Math.min(...angles)).toFixed(1))
        : null,
    cycleIntervals,
    averageCycleSeconds: cycleIntervals.length
      ? Number(
          (
            cycleIntervals.reduce((sum, value) => sum + value, 0) /
            cycleIntervals.length
          ).toFixed(2),
        )
      : null,
    markedPhases,
    releaseAngles,
    meanReleaseAngle:
      meanReleaseAngle === null ? null : Number(meanReleaseAngle.toFixed(1)),
    releaseAngleDeviation:
      releaseAngleDeviation === null
        ? null
        : Number(releaseAngleDeviation.toFixed(1)),
  };
}
export function movementVelocity(series: AngleSample[]) {
  const velocities = series.slice(1).flatMap((sample, index) => {
    const elapsed = sample.time - series[index].time;
    return elapsed > 0
      ? [Math.abs(sample.angle - series[index].angle) / elapsed]
      : [];
  });
  return {
    average: velocities.length
      ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length
      : null,
    peak: velocities.length ? Math.max(...velocities) : null,
  };
}
export function detectSquatRepetitions(
  series: AngleSample[],
  bottomAngle: number,
  standingAngle: number,
) {
  let standing = false;
  let reachedDepth = false;
  const reps: number[] = [];
  for (const sample of series) {
    if (sample.angle >= standingAngle) {
      if (standing && reachedDepth) reps.push(sample.time);
      standing = true;
      reachedDepth = false;
    } else if (standing && sample.angle <= bottomAngle) {
      reachedDepth = true;
    }
  }
  return reps;
}
export function csvSessions(sessions: Session[]) {
  const escape = (v: string | number) =>
    '"' +
    String(v)
      .replaceAll('"', '""')
      .replace(/^[=+@-]/, "'$&") +
    '"';
  return [
    "Date,Drill,Reps,Target,Makes,Misses,Success %,Tags,Notes,Duration minutes,Session RPE,Session load AU",
    ...sessions.map((s) =>
      [
        s.date,
        s.name,
        s.reps,
        s.target,
        s.makes,
        s.misses,
        successRate(s.makes, s.misses) ?? "",
        s.tags.join("; "),
        s.notes,
        s.durationMinutes ?? "",
        s.sessionRpe ?? "",
        calculateSessionLoad(s.durationMinutes, s.sessionRpe) ?? "",
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\r\n");
}
