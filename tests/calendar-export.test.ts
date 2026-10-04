import assert from "node:assert/strict";
import test from "node:test";
import { workoutsToCalendar } from "../lib/calendar-export";

test("calendar export makes escaped, all-day workout events", () => {
  const calendar = workoutsToCalendar([
    {
      id: "workout-1",
      name: "Shooting, footwork; review",
      date: "2026-10-04",
      target: 50,
      done: false,
    },
  ]);
  assert.match(calendar, /BEGIN:VCALENDAR/);
  assert.match(calendar, /DTSTART;VALUE=DATE:20261004/);
  assert.match(calendar, /DTEND;VALUE=DATE:20261005/);
  assert.match(calendar, /SUMMARY:Shooting\\, footwork\\; review/);
  assert.match(calendar, /DESCRIPTION:50 target reps/);
});
