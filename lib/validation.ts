import { z } from "zod";
const point = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export const sessionInput = z.object({
  name: z.string().trim().min(1).max(100),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(v + "T00:00:00Z");
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, "Invalid date"),
  makes: z.number().int().min(0).max(100000),
  misses: z.number().int().min(0).max(100000),
  reps: z.number().int().min(0).max(100000),
  target: z.number().int().min(0).max(100000),
  notes: z.string().max(5000),
  durationMinutes: z.number().min(0).max(1440).nullable().optional(),
  sessionRpe: z.number().min(0).max(10).nullable().optional(),
  tags: z
    .array(
      z.enum([
        "Shooting",
        "Speed",
        "Plyometrics",
        "Defense",
        "Strength",
        "Footwork",
      ]),
    )
    .max(6),
  fps: z.number().min(0.1).max(1000),
  drawings: z
    .array(
      z
        .object({
          id: z.string().max(100),
          tool: z.enum(["pen", "line", "angle"]),
          points: z.array(point).min(1).max(10000),
          color: z.enum(["#b7f76b", "#55d8f5", "#ffaf67"]),
          time: z.number().min(0).max(86400),
        })
        .superRefine((d, ctx) => {
          if (
            (d.tool === "angle" && d.points.length !== 3) ||
            (d.tool === "line" && d.points.length !== 2)
          )
            ctx.addIssue({ code: "custom", message: "Invalid drawing points" });
        }),
    )
    .max(500),
  videoId: z.string().uuid().optional(),
  revision: z.string().max(100).optional(),
  trimStart: z.number().min(0).max(1800).default(0),
  trimEnd: z.number().min(0).max(1800).nullable().default(null),
  rotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0),
});
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export function validVideoHeader(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (mime === "video/mp4" || mime === "video/quicktime")
    return bytes.length >= 12 && ascii(4, 8) === "ftyp";
  return (
    mime === "video/webm" &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

export function sameRequestOrigin(
  origin: string | null,
  host: string,
): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}
