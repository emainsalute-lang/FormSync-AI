import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateSessionLoad, type Session } from "../lib/model";
import {
  blankWellness,
  wellnessEntrySchema,
  wellnessHistorySchema,
  wellnessTrainingDays,
  wellnessCsv,
  type WellnessEntry,
} from "../lib/wellness";
import { workspaceSchema, emptyWorkspace, csvSessions } from "../lib/training";
import { sessionInput } from "../lib/validation";
const entry: WellnessEntry = {
  ...blankWellness("2026-10-01"),
  id: "00000000-0000-4000-8000-000000000001",
  sleepHours: 0,
  mood: 4,
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-01T08:00:00Z",
};
const session: Session = {
  id: entry.id,
  name: "Test",
  date: entry.date,
  makes: 1,
  misses: 1,
  reps: 20,
  target: 30,
  notes: "",
  tags: [],
  fps: 30,
  drawings: [],
  videoId: "00000000-0000-4000-8000-000000000002",
  videoName: "test.mp4",
  videoType: "video/mp4",
  createdAt: entry.createdAt,
};
test("session load preserves legitimate zeros and handles missing, fractional, and invalid ratings", () => {
  assert.equal(calculateSessionLoad(45, 7), 315);
  assert.equal(calculateSessionLoad(32.5, 6.5), 211.25);
  assert.equal(calculateSessionLoad(30, 0), 0);
  assert.equal(calculateSessionLoad(0, 7), 0);
  for (const [minutes, rpe] of [
    [null, 7],
    [30, undefined],
    [30, 11],
    [-1, 7],
    [Infinity, 5],
    [5, NaN],
    [1441, 5],
  ])
    assert.equal(calculateSessionLoad(minutes, rpe), null);
});
test("wellness accepts partial reporting and zero sleep without inventing ratings", () => {
  assert.equal(wellnessEntrySchema.safeParse(entry).success, true);
  assert.equal(
    wellnessEntrySchema.safeParse({ ...entry, sleepHours: null, mood: null })
      .success,
    false,
  );
  assert.equal(
    wellnessEntrySchema.safeParse({
      ...entry,
      sleepHours: null,
      bodyweightKg: 75.2,
    }).success,
    true,
  );
  assert.equal(
    wellnessEntrySchema.safeParse({ ...entry, sleepHours: 25 }).success,
    false,
  );
  assert.equal(
    wellnessEntrySchema.safeParse({ ...entry, stress: 0 }).success,
    false,
  );
  assert.equal(
    wellnessEntrySchema.safeParse({ ...entry, mood: 2.5 }).success,
    false,
  );
  assert.equal(
    wellnessEntrySchema.safeParse({ ...entry, bodyweightKg: 0 }).success,
    false,
  );
  assert.equal(
    wellnessEntrySchema.safeParse({ ...entry, date: "2026-02-30" }).success,
    false,
  );
});
test("wellness history rejects duplicate dates and duplicate IDs", () => {
  assert.equal(
    wellnessHistorySchema.safeParse([entry, { ...entry, id: session.videoId }])
      .success,
    false,
  );
  assert.equal(
    wellnessHistorySchema.safeParse([entry, { ...entry, date: "2026-10-02" }])
      .success,
    false,
  );
});
test("same-day outcomes weight attempts, sum only reported load, and keep missing days distinct", () => {
  const result = wellnessTrainingDays(
    [
      entry,
      { ...entry, id: session.videoId, date: "2026-10-03", sleepHours: 8 },
    ],
    [
      { ...session, durationMinutes: 45, sessionRpe: 7 },
      {
        ...session,
        makes: 9,
        misses: 0,
        reps: 40,
        durationMinutes: 30,
        sessionRpe: 0,
      },
      { ...session, makes: 0, misses: 0, reps: 10 },
      { ...session, date: "2026-10-02", makes: 0, misses: 0, reps: 0 },
    ],
  );
  assert.equal(result[0].success, 91);
  assert.equal(result[0].load, 315);
  assert.equal(result[0].loadReports, 2);
  assert.equal(result[0].sessions, 3);
  assert.equal(result[0].duration, 75);
  assert.equal(result[0].wellness?.sleepHours, 0);
  assert.equal(result[1].wellness, null);
  assert.equal(result[1].reps, 0);
  assert.equal(result[1].success, null);
  assert.equal(result[1].load, null);
  assert.equal(result[2].sessions, 0);
  assert.equal(result[2].reps, null);
});
test("legacy workspace migration defaults wellness to an empty array", () => {
  const { wellness, ...old } = emptyWorkspace();
  assert.deepEqual(workspaceSchema.parse(old).wellness, []);
});
test("CSV includes wellness and session load without replacing blanks with zeros", () => {
  assert.match(wellnessCsv([entry]), /"2026-10-01","0","","","","4","",""/);
  assert.match(
    csvSessions([
      { ...session, durationMinutes: 45, sessionRpe: 7, sessionLoad: 999 },
    ]),
    /"45","7","315"/,
  );
  assert.match(csvSessions([session]), /"","",""/);
});
test("session validation bounds whole-session duration and RPE", () => {
  const valid = { ...session, durationMinutes: 45, sessionRpe: 7 };
  assert.equal(sessionInput.safeParse(valid).success, true);
  assert.equal(
    sessionInput.safeParse({ ...valid, sessionRpe: 11 }).success,
    false,
  );
  assert.equal(
    sessionInput.safeParse({ ...valid, durationMinutes: -1 }).success,
    false,
  );
  assert.equal(
    sessionInput.safeParse({
      ...valid,
      durationMinutes: null,
      sessionRpe: null,
    }).success,
    true,
  );
});
