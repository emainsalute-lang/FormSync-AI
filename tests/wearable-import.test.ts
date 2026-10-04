import assert from "node:assert/strict";
import test from "node:test";
import { parseWearableActivities } from "../lib/wearable-import";

test("wearable CSV import parses quoted fields and measured activity values", () => {
  const [item] = parseWearableActivities(
    "export.csv",
    'date,activity,duration_seconds,distance_meters,calories,average_heart_rate\r\n2026-10-04T10:00:00Z,"Run, easy",1800,5000,250,142',
  );
  assert.equal(item.name, "Run, easy");
  assert.equal(item.source, "CSV");
  assert.equal(item.durationSeconds, 1800);
  assert.equal(item.distanceMeters, 5000);
  assert.equal(item.calories, 250);
  assert.equal(item.averageHeartRate, 142);
});

test("wearable CSV import rejects unsupported or malformed data", () => {
  assert.throws(
    () => parseWearableActivities("workout.fit", "binary"),
    /Choose a TCX/,
  );
  assert.throws(
    () =>
      parseWearableActivities(
        "workout.csv",
        "date,duration_seconds\n2026-10-04,-2",
      ),
    /Invalid non-negative measurement/,
  );
});
