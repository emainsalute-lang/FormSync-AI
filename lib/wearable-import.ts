export type WearableActivity = {
  id: string;
  name: string;
  source: "TCX" | "GPX" | "CSV";
  startedAt: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  calories: number | null;
  averageHeartRate: number | null;
  importedAt: string;
};

function positiveNumber(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`Invalid non-negative measurement: ${value}`);
  return parsed;
}
function activity(
  input: Omit<WearableActivity, "id" | "importedAt">,
): WearableActivity {
  return {
    ...input,
    id: crypto.randomUUID(),
    importedAt: new Date().toISOString(),
  };
}
function csvFields(line: string) {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  fields.push(field);
  return fields;
}
function importCsv(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2)
    throw new Error("CSV needs a header and at least one activity.");
  const headers = csvFields(lines[0]).map((value) =>
    value.trim().toLowerCase(),
  );
  const index = (names: string[]) =>
    headers.findIndex((head) => names.includes(head));
  const dateAt = index(["date", "start_time", "started_at", "start date"]);
  const nameAt = index(["activity", "name", "sport", "workout"]);
  const durationAt = index([
    "duration_seconds",
    "duration (s)",
    "moving_time_seconds",
  ]);
  const distanceAt = index(["distance_meters", "distance (m)", "distance"]);
  const caloriesAt = index(["calories", "kcal"]);
  const hrAt = index(["average_heart_rate", "avg_hr", "average hr"]);
  if (dateAt < 0 && durationAt < 0 && distanceAt < 0)
    throw new Error("CSV must include date, duration, or distance columns.");
  return lines.slice(1, 1001).map((line) => {
    const row = csvFields(line);
    const dateValue = dateAt < 0 ? null : row[dateAt]?.trim() || null;
    const startedAt =
      dateValue && Number.isFinite(Date.parse(dateValue))
        ? new Date(dateValue).toISOString()
        : null;
    return activity({
      name: (nameAt < 0 ? "" : row[nameAt]?.trim()) || "Imported workout",
      source: "CSV",
      startedAt,
      durationSeconds: durationAt < 0 ? null : positiveNumber(row[durationAt]),
      distanceMeters: distanceAt < 0 ? null : positiveNumber(row[distanceAt]),
      calories: caloriesAt < 0 ? null : positiveNumber(row[caloriesAt]),
      averageHeartRate:
        hrAt < 0
          ? null
          : positiveNumber(row[hrAt])
            ? Math.round(Number(row[hrAt]))
            : null,
    });
  });
}
function parseXml(text: string) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror"))
    throw new Error("Wearable file is not valid XML.");
  return document;
}
function text(node: ParentNode, selector: string) {
  return node.querySelector(selector)?.textContent?.trim() || "";
}
function importTcx(input: string) {
  const doc = parseXml(input);
  const activityNode = doc.getElementsByTagNameNS("*", "Activity").item(0);
  const records = Array.from(doc.getElementsByTagNameNS("*", "Trackpoint"));
  const times = records
    .map((point) => Date.parse(text(point, "Time")))
    .filter(Number.isFinite);
  const distances = records
    .map((point) => positiveNumber(text(point, "DistanceMeters")))
    .filter((n): n is number => n !== null);
  const heartRates = records
    .map((point) => positiveNumber(text(point, "Value")))
    .filter((n): n is number => n !== null && n >= 20 && n <= 250);
  const calories = positiveNumber(text(doc, "Calories"));
  const start = times.length ? Math.min(...times) : null;
  const end = times.length ? Math.max(...times) : null;
  return [
    activity({
      name:
        activityNode?.getAttribute("Sport") ||
        text(doc, "Id") ||
        "Imported workout",
      source: "TCX",
      startedAt: start === null ? null : new Date(start).toISOString(),
      durationSeconds:
        start === null || end === null
          ? null
          : Math.max(0, (end - start) / 1000),
      distanceMeters: distances.length ? Math.max(...distances) : null,
      calories,
      averageHeartRate: heartRates.length
        ? Math.round(
            heartRates.reduce((sum, value) => sum + value, 0) /
              heartRates.length,
          )
        : null,
    }),
  ];
}
function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}
function importGpx(input: string) {
  const doc = parseXml(input);
  const points = Array.from(doc.getElementsByTagNameNS("*", "trkpt"));
  const times = points
    .map((point) => Date.parse(text(point, "time")))
    .filter(Number.isFinite);
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const lat1 = Number(points[i - 1].getAttribute("lat"));
    const lon1 = Number(points[i - 1].getAttribute("lon"));
    const lat2 = Number(points[i].getAttribute("lat"));
    const lon2 = Number(points[i].getAttribute("lon"));
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) continue;
    const dLat = radians(lat2 - lat1);
    const dLon = radians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat1)) *
        Math.cos(radians(lat2)) *
        Math.sin(dLon / 2) ** 2;
    distance += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const start = times.length ? Math.min(...times) : null;
  const end = times.length ? Math.max(...times) : null;
  return [
    activity({
      name: text(doc, "trk") || text(doc, "name") || "Imported workout",
      source: "GPX",
      startedAt: start === null ? null : new Date(start).toISOString(),
      durationSeconds:
        start === null || end === null
          ? null
          : Math.max(0, (end - start) / 1000),
      distanceMeters: distance > 0 ? distance : null,
      calories: null,
      averageHeartRate: null,
    }),
  ];
}
export function parseWearableActivities(fileName: string, contents: string) {
  if (contents.length > 10 * 1024 * 1024)
    throw new Error("Import file must be 10 MB or smaller.");
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv") return importCsv(contents);
  if (ext === "tcx") return importTcx(contents);
  if (ext === "gpx") return importGpx(contents);
  throw new Error("Choose a TCX, GPX, or CSV workout export.");
}
