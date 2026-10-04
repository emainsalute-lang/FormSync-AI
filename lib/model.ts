export type Point = { x: number; y: number };
export type Drawing = {
  id: string;
  tool: "pen" | "line" | "angle";
  points: Point[];
  color: string;
  time: number;
};
export type Session = {
  id: string;
  ownerId?: string;
  name: string;
  date: string;
  makes: number;
  misses: number;
  reps: number;
  target: number;
  durationMinutes?: number | null;
  sessionRpe?: number | null;
  sessionLoad?: number | null;
  notes: string;
  tags: string[];
  fps: number;
  drawings: Drawing[];
  videoId: string;
  videoName: string;
  videoType: string;
  createdAt: string;
  updatedAt?: string;
  revision?: string;
  rotation?: 0 | 90 | 180 | 270;
};
export const TAGS = [
  "Shooting",
  "Speed",
  "Plyometrics",
  "Defense",
  "Strength",
  "Footwork",
];
export function jointAngle(
  points: Point[],
  width = 1,
  height = 1,
): number | null {
  if (points.length !== 3) return null;
  const [a, b, c] = points;
  const u = { x: (a.x - b.x) * width, y: (a.y - b.y) * height };
  const v = { x: (c.x - b.x) * width, y: (c.y - b.y) * height };
  const denominator = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (!denominator) return null;
  return (
    (Math.acos(
      Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / denominator)),
    ) *
      180) /
    Math.PI
  );
}
export function successRate(makes: number, misses: number): number | null {
  return makes + misses > 0
    ? Math.round((makes / (makes + misses)) * 100)
    : null;
}
export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function timeLabel(value: number): string {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(value % 60)
    .toString()
    .padStart(2, "0")}.${Math.floor((value % 1) * 100)
    .toString()
    .padStart(2, "0")}`;
}

export function calculateSessionLoad(
  durationMinutes?: number | null,
  sessionRpe?: number | null,
): number | null {
  if (
    durationMinutes === null ||
    durationMinutes === undefined ||
    sessionRpe === null ||
    sessionRpe === undefined ||
    !Number.isFinite(durationMinutes) ||
    !Number.isFinite(sessionRpe) ||
    durationMinutes < 0 ||
    durationMinutes > 1440 ||
    sessionRpe < 0 ||
    sessionRpe > 10
  )
    return null;
  return Math.round(durationMinutes * sessionRpe * 100) / 100;
}
