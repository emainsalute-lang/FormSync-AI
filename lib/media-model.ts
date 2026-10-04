import type { Drawing } from "./model";
export type Rotation = 0 | 90 | 180 | 270;
export type ClipEdits = {
  trimStart: number;
  trimEnd: number | null;
  rotation: Rotation;
};
export const emptyEdits = (): ClipEdits => ({
  trimStart: 0,
  trimEnd: null,
  rotation: 0,
});
export type MediaInfo = {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  frames: number[];
  variableFrameRate: boolean;
  hasAudio: boolean;
};
export function nearestFrame(frames: number[], time: number): number {
  if (!frames.length) return 0;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(frames[lo - 1] - time) < Math.abs(frames[lo] - time)
    ? lo - 1
    : lo;
}
export function frameTiming(timestamps: number[], declaredFps = 30) {
  const first = timestamps[0] || 0;
  const frames = timestamps.map((t) => Math.max(0, t - first));
  const diffs = frames
    .slice(1)
    .map((t, i) => t - frames[i])
    .filter((d) => d > 0);
  const sorted = [...diffs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const step = sorted.length
    ? sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
    : 1 / (declaredFps > 0 ? declaredFps : 30);
  const medianFps = 1 / step;
  const fps =
    declaredFps > 0 && Number.isFinite(declaredFps) ? declaredFps : medianFps;
  return {
    frames,
    fps: Math.round(fps * 1000) / 1000,
    step,
    variableFrameRate: diffs.some(
      (d) => Math.abs(d - step) > Math.max(0.001, step * 0.08),
    ),
  };
}
export function screenToVideo(
  x: number,
  y: number,
  width: number,
  height: number,
  nativeWidth: number,
  nativeHeight: number,
  rotation: Rotation,
  zoom: number,
  pan: { x: number; y: number },
  planeSize?: { width: number; height: number },
) {
  const theta = (rotation * Math.PI) / 180;
  const dx = x - width / 2 - pan.x,
    dy = y - height / 2 - pan.y;
  const quarter = rotation === 90 || rotation === 270;
  const planeWidth =
    planeSize?.width ??
    (quarter ? (width * nativeWidth) / nativeHeight : width);
  const planeHeight =
    planeSize?.height ??
    (quarter ? (height * nativeHeight) / nativeWidth : height);
  return {
    x: Math.max(
      0,
      Math.min(
        1,
        (Math.cos(theta) * dx + Math.sin(theta) * dy) / zoom / planeWidth + 0.5,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        1,
        (-Math.sin(theta) * dx + Math.cos(theta) * dy) / zoom / planeHeight +
          0.5,
      ),
    ),
  };
}

export function trimFrameRange(
  frames: number[],
  start: number,
  end: number,
): { startIndex: number; endIndex: number } | null {
  const startIndex = frames.findIndex((t) => t >= start - 0.000001);
  if (startIndex < 0) return null;
  const endIndexRaw = frames.findIndex(
    (t, i) => i >= startIndex && t >= end - 0.000001,
  );
  const endIndex = endIndexRaw < 0 ? frames.length : endIndexRaw;
  return endIndex > startIndex ? { startIndex, endIndex } : null;
}
export function remapTrimmedDrawings(
  drawings: Drawing[],
  original: number[],
  trimmed: number[],
  start: number,
  end: number,
): Drawing[] {
  const range = trimFrameRange(original, start, end);
  if (!range || !trimmed.length) return [];
  return drawings.flatMap((d) => {
    if (d.time < start || d.time >= end) return [];
    const source = nearestFrame(original, d.time);
    if (source < range.startIndex || source >= range.endIndex) return [];
    const target = Math.min(trimmed.length - 1, source - range.startIndex);
    return [{ ...d, time: trimmed[target] }];
  });
}

export function rotateDrawings(
  drawings: Drawing[],
  rotation: Rotation,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): Drawing[] {
  const quarter = rotation === 90 || rotation === 270;
  const rotatedWidth = quarter ? height : width,
    rotatedHeight = quarter ? width : height;
  return drawings.map((d) => ({
    ...d,
    points: d.points.map((p) => {
      const point =
        rotation === 90
          ? { x: 1 - p.y, y: p.x }
          : rotation === 180
            ? { x: 1 - p.x, y: 1 - p.y }
            : rotation === 270
              ? { x: p.y, y: 1 - p.x }
              : p;
      return {
        x: (point.x * rotatedWidth) / outputWidth,
        y: (point.y * rotatedHeight) / outputHeight,
      };
    }),
  }));
}
