import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { type Session } from "./model";
import { videoPath } from "./storage";
import { getMediaInfo, MediaError, runMediaProcess } from "./media-service";
import { annotationSvg, annotationWindows } from "./annotation-export";
export async function exportAnnotatedVideo(session: Session) {
  const media = await getMediaInfo(session.videoId);
  if (media.duration > 180)
    throw new MediaError(
      "Annotated video export supports clips up to three minutes. Trim the session first.",
      422,
    );
  if (
    session.drawings.length > 100 ||
    session.drawings.reduce((n, d) => n + d.points.length, 0) > 50000
  )
    throw new MediaError(
      "Export supports up to 100 annotations and 50,000 pen points. Reduce markup before exporting.",
      422,
    );
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "formsync-export-"));
  try {
    const scale = Math.min(1, 1920 / Math.max(media.width, media.height)),
      w = Math.max(2, Math.round((media.width * scale) / 2) * 2),
      h = Math.max(2, Math.round((media.height * scale) / 2) * 2);
    const windows = annotationWindows(
      session.drawings,
      media.frames,
      media.duration,
    );
    const bounds = [
      ...new Set([
        0,
        media.duration,
        ...windows.flatMap((d) => [d.start, d.end]),
      ]),
    ].sort((a, b) => a - b);
    const list = ["ffconcat version 1.0"];
    for (let i = 0; i < bounds.length - 1; i++) {
      const mid = (bounds[i] + bounds[i + 1]) / 2,
        active = windows
          .filter((d) => mid >= d.start && mid < d.end)
          .map((d) => d.drawing);
      await sharp(Buffer.from(annotationSvg(active, w, h)))
        .png()
        .toFile(path.join(temp, `overlay-${i}.png`));
      list.push(
        `file 'overlay-${i}.png'`,
        "option framerate 1000",
        `duration ${(bounds[i + 1] - bounds[i]).toFixed(6)}`,
      );
    }
    await sharp(Buffer.from(annotationSvg([], w, h)))
      .png()
      .toFile(path.join(temp, "end.png"));
    list.push("file 'end.png'", "option framerate 1000");
    await fs.writeFile(path.join(temp, "overlays.txt"), list.join("\n"));
    await runMediaProcess(
      [
        "-v",
        "error",
        "-i",
        videoPath(session.videoId),
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "overlays.txt",
        "-filter_complex",
        `[0:v]scale=${w}:${h},setsar=1,setpts=PTS-STARTPTS[base];[base][1:v]overlay=eof_action=pass:repeatlast=0:format=auto[out]`,
        "-map",
        "[out]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-vsync",
        "0",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-t",
        String(media.duration),
        "-fs",
        String(150 * 1024 * 1024),
        "-y",
        "export.mp4",
      ],
      temp,
    );
    const file = path.join(temp, "export.mp4"),
      stat = await fs.stat(file);
    if (stat.size >= 149 * 1024 * 1024)
      throw new MediaError(
        "Export exceeds 150 MB. Trim the clip and try again.",
        422,
      );
    return await fs.readFile(file);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
