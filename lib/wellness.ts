import { z } from "zod";
import { calculateSessionLoad, successRate, type Session } from "./model";
export const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");
const rating = z.number().int().min(1).max(5).nullable();
export const wellnessEntrySchema = z
  .object({
    id: z.string().uuid(),
    date: calendarDay,
    sleepHours: z.number().min(0).max(24).nullable(),
    sleepQuality: rating,
    soreness: rating,
    stress: rating,
    mood: rating,
    bodyweightKg: z.number().min(1).max(500).nullable(),
    notes: z.string().max(2000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine(
    (e) =>
      [
        e.sleepHours,
        e.sleepQuality,
        e.soreness,
        e.stress,
        e.mood,
        e.bodyweightKg,
      ].some((v) => v !== null),
    "Report at least one wellness measurement.",
  );
export const wellnessHistorySchema = z
  .array(wellnessEntrySchema)
  .max(3660)
  .refine(
    (rows) => new Set(rows.map((r) => r.date)).size === rows.length,
    "Only one wellness check-in is allowed per date.",
  )
  .refine(
    (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
    "Wellness entry IDs must be unique.",
  );
export type WellnessEntry = z.infer<typeof wellnessEntrySchema>;
export type WellnessForm = Pick<
  WellnessEntry,
  | "date"
  | "sleepHours"
  | "sleepQuality"
  | "soreness"
  | "stress"
  | "mood"
  | "bodyweightKg"
  | "notes"
>;
export function blankWellness(date: string): WellnessForm {
  return {
    date,
    sleepHours: null,
    sleepQuality: null,
    soreness: null,
    stress: null,
    mood: null,
    bodyweightKg: null,
    notes: "",
  };
}
export function wellnessTrainingDays(
  wellness: WellnessEntry[],
  sessions: Session[],
) {
  const days = new Map<
    string,
    {
      date: string;
      sessions: number;
      reps: number;
      makes: number;
      misses: number;
      duration: number;
      durationReports: number;
      load: number;
      loadReports: number;
    }
  >();
  for (const s of sessions) {
    const d = days.get(s.date) || {
      date: s.date,
      sessions: 0,
      reps: 0,
      makes: 0,
      misses: 0,
      duration: 0,
      durationReports: 0,
      load: 0,
      loadReports: 0,
    };
    d.sessions++;
    d.reps += s.reps;
    d.makes += s.makes;
    d.misses += s.misses;
    if (
      s.durationMinutes !== null &&
      s.durationMinutes !== undefined &&
      Number.isFinite(s.durationMinutes)
    ) {
      d.duration += s.durationMinutes;
      d.durationReports++;
    }
    const load = calculateSessionLoad(s.durationMinutes, s.sessionRpe);
    if (load !== null) {
      d.load += load;
      d.loadReports++;
    }
    days.set(s.date, d);
  }
  const checkins = new Map(wellness.map((w) => [w.date, w]));
  return [...new Set([...days.keys(), ...checkins.keys()])]
    .sort()
    .map((date) => {
      const training = days.get(date);
      return {
        date,
        wellness: checkins.get(date) ?? null,
        sessions: training?.sessions ?? 0,
        reps: training?.reps ?? null,
        success: training ? successRate(training.makes, training.misses) : null,
        duration: training?.durationReports
          ? Math.round(training.duration * 100) / 100
          : null,
        load: training?.loadReports
          ? Math.round(training.load * 100) / 100
          : null,
        loadReports: training?.loadReports ?? 0,
      };
    });
}
export const WELLNESS_METRICS = {
  sleepHours: { label: "Sleep duration", unit: "hours", min: 0, max: 24 },
  sleepQuality: { label: "Sleep quality", unit: "1–5", min: 1, max: 5 },
  soreness: { label: "Muscle soreness", unit: "1–5", min: 1, max: 5 },
  stress: { label: "Stress", unit: "1–5", min: 1, max: 5 },
  mood: { label: "Mood", unit: "1–5", min: 1, max: 5 },
} as const;
export const OUTCOME_METRICS = {
  success: { label: "Success rate", unit: "%" },
  reps: { label: "Repetitions", unit: "reps" },
  load: { label: "Session load", unit: "AU" },
} as const;
export function wellnessCsv(rows: WellnessEntry[]) {
  const esc = (v: string | number | null) =>
    '"' +
    String(v ?? "")
      .replaceAll('"', '""')
      .replace(/^[=+@-]/, "'$&") +
    '"';
  return [
    "Date,Sleep hours,Sleep quality (1-5),Soreness (1-5),Stress (1-5),Mood (1-5),Bodyweight kg,Notes",
    ...rows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) =>
        [
          w.date,
          w.sleepHours,
          w.sleepQuality,
          w.soreness,
          w.stress,
          w.mood,
          w.bodyweightKg,
          w.notes,
        ]
          .map(esc)
          .join(","),
      ),
  ].join("\r\n");
}
