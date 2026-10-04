import { jointAngle, type Drawing } from "./model";
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  drawings: Drawing[],
  width: number,
  height: number,
) {
  const strokeWidth = Math.max(3, width / 500);
  for (const d of drawings) {
    const points = d.points.map((p) => ({ x: p.x * width, y: p.y * height }));
    if (!points.length) continue;
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, strokeWidth, 0, Math.PI * 2);
      ctx.fill();
    }
    if (d.tool === "angle") {
      points.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, strokeWidth * 2, 0, Math.PI * 2);
        ctx.fill();
      });
      const angle = jointAngle(d.points, width, height);
      if (angle !== null) {
        const b = points[1];
        const size = Math.max(20, width / 55);
        ctx.font = `600 ${size}px sans-serif`;
        const label = `${angle.toFixed(1)}\u00b0`;
        const w = ctx.measureText(label).width;
        const x = Math.min(width - w - 24, Math.max(0, b.x + 12));
        const y = Math.max(size + 10, b.y - 14);
        ctx.fillStyle = "#111810";
        ctx.fillRect(x, y - size - 7, w + 20, size + 14);
        ctx.fillStyle = d.color;
        ctx.fillText(label, x + 10, y);
      }
    }
  }
}
