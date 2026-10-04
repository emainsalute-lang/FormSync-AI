import { jointAngle, type Drawing } from "./model";
import { nearestFrame } from "./media-model";
export function annotationWindows(
  drawings: Drawing[],
  frames: number[],
  duration: number,
) {
  return drawings
    .filter((d) => d.time <= duration && d.time >= 0)
    .map((d) => {
      const i = nearestFrame(frames, d.time);
      return {
        drawing: d,
        start: i ? (frames[i - 1] + frames[i]) / 2 : 0,
        end: i + 1 < frames.length ? (frames[i] + frames[i + 1]) / 2 : duration,
      };
    });
}
export function annotationSvg(
  drawings: Drawing[],
  width: number,
  height: number,
) {
  const stroke = Math.max(2, width / 400);
  const parts = drawings.map((d) => {
    const points = d.points
      .map((p) => `${(p.x * width).toFixed(2)},${(p.y * height).toFixed(2)}`)
      .join(" ");
    const shape =
      d.points.length === 1
        ? `<circle cx="${d.points[0].x * width}" cy="${d.points[0].y * height}" r="${stroke}" fill="${d.color}"/>`
        : `<polyline points="${points}" fill="none" stroke="${d.color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const angle =
      d.tool === "angle" ? jointAngle(d.points, width, height) : null;
    const vertex = d.points[1];
    return (
      shape +
      (angle !== null && vertex
        ? `<text x="${Math.min(width - 55, vertex.x * width + 10)}" y="${Math.max(22, vertex.y * height - 10)}" font-family="sans-serif" font-size="${Math.max(16, width / 60)}" fill="${d.color}" stroke="#101212" stroke-width="1" paint-order="stroke">${Math.round(angle)}°</text>`
        : "")
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}
