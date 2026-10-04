import "server-only";
import { readDocument, writeDocument, database } from "./database";
import { storeObject, ensureObject, removeObjects } from "./object-store";
import { assertCapacity } from "./storage-policy";
import { enqueue } from "./upload-service";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DATA_DIR,
  initStore,
  videoPath,
  getVideoSession,
  setMediaOwner,
} from "./storage";
import { withMediaLock } from "./media-lock";
import {
  frameTiming,
  trimFrameRange,
  type MediaInfo,
  type Rotation,
} from "./media-model";
import { MAX_VIDEO_BYTES, validVideoHeader } from "./validation";
export class MediaError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const metaPath = (id: string) => path.join(DATA_DIR, "metadata", id + ".json");
export const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
let active = 0;
const waiters: Array<() => void> = [];
async function runBinary(
  binary: string,
  args: string[],
  limit = 64 * 1024 * 1024,
  cwd?: string,
): Promise<Buffer> {
  if (active >= 2) {
    if (waiters.length >= 12)
      throw new MediaError("Video processing is busy. Please retry.", 503);
    await new Promise<void>((resolve) => waiters.push(resolve));
  } else active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(binary, args, {
        windowsHide: true,
        shell: false,
        cwd,
      });
      const chunks: Buffer[] = [];
      let length = 0,
        stderr = "";
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new MediaError(
          "Video processing took too long. Try a shorter clip.",
          422,
        );
        child.kill();
      }, 180000);
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > limit) {
          failure = new MediaError(
            "Video analysis exceeds the supported size.",
            422,
          );
          child.kill();
        } else chunks.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-10000);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0) {
          console.error("Media process failed", stderr);
          reject(
            new MediaError(
              "This clip could not be processed. Try an H.264 MP4 or WebM.",
              422,
            ),
          );
        } else resolve(Buffer.concat(chunks));
      });
    });
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}
export async function runMediaProcess(args: string[], cwd?: string) {
  if (!ffmpeg && !process.env.FORMSYNC_FFMPEG_PATH)
    throw new MediaError("Video processor is unavailable.", 503);
  return runBinary(
    process.env.FORMSYNC_FFMPEG_PATH || ffmpeg!,
    args,
    64 * 1024 * 1024,
    cwd,
  );
}
async function saveMedia(info: MediaInfo) {
  await storeObject("videos/" + info.id, info.id, info.type);
  writeDocument("media", info.id, info);
  enqueue("optimize", info.id);
  await fs.mkdir(path.dirname(metaPath(info.id)), { recursive: true });
  const temp = metaPath(info.id) + "." + randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(info));
  await fs.rename(temp, metaPath(info.id));
}
export async function removeMedia(id: string) {
  if (!validId(id)) throw new MediaError("Invalid video ID.");
  await removeObjects(id);
  database()
    .prepare(
      "UPDATE jobs SET state='done',error=NULL,lease_until=0 WHERE kind='optimize' AND media_id=? AND state='queued'",
    )
    .run(id);
  database()
    .prepare("DELETE FROM documents WHERE collection='media' AND id=?")
    .run(id);
  database().prepare("DELETE FROM media_owners WHERE media_id=?").run(id);
  await Promise.all(
    [videoPath(id), metaPath(id)].map((file) =>
      fs.unlink(file).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      }),
    ),
  );
}
export async function findMedia(id: string): Promise<MediaInfo | null> {
  if (!validId(id)) return null;
  try {
    const info =
      readDocument<MediaInfo>("media", id) ||
      (JSON.parse(await fs.readFile(metaPath(id), "utf8")) as MediaInfo);
    await ensureObject("videos/" + id);
    return info;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const s = await getVideoSession(id);
  if (!s) return null;
  try {
    await fs.access(videoPath(id));
  } catch {
    return null;
  }
  return {
    id,
    name: s.videoName,
    type: s.videoType,
    width: 0,
    height: 0,
    duration: 0,
    fps: s.fps,
    frames: [],
    variableFrameRate: false,
    hasAudio: false,
  };
}
const pending = new Map<string, Promise<MediaInfo>>();
export async function getMediaInfo(id: string): Promise<MediaInfo> {
  const found = await findMedia(id);
  if (!found) throw new MediaError("Video not found.", 404);
  if (found.frames.length && found.width && found.height) return found;
  let operation = pending.get(id);
  if (!operation) {
    operation = probeMedia(id, found.name, found.type).finally(() =>
      pending.delete(id),
    );
    pending.set(id, operation);
  }
  return operation;
}
export async function probeMedia(
  id: string,
  name: string,
  type: string,
): Promise<MediaInfo> {
  const bytes = await runBinary(
    process.env.FORMSYNC_FFPROBE_PATH || ffprobe.path,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream:format=duration:frame=media_type,best_effort_timestamp_time",
      "-of",
      "json",
      videoPath(id),
    ],
  );
  const data = JSON.parse(bytes.toString());
  const stream = data.streams?.[0];
  if (!stream) throw new MediaError("This file has no video stream.", 422);
  let width = Number(stream.width),
    height = Number(stream.height);
  const rotation = Number(
    stream.side_data_list?.find(
      (v: { rotation?: number }) => typeof v.rotation === "number",
    )?.rotation ??
      stream.tags?.rotate ??
      0,
  );
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16000000
  )
    throw new MediaError("Video dimensions exceed 16 megapixels.", 422);
  const timestamps = (data.frames || [])
    .filter(
      (f: { media_type?: string }) => !f.media_type || f.media_type === "video",
    )
    .map((f: { best_effort_timestamp_time?: string }) =>
      Number(f.best_effort_timestamp_time),
    )
    .filter(Number.isFinite);
  if (!timestamps.length || timestamps.length > 250000)
    throw new MediaError(
      "Video has no supported frames or exceeds 250,000 frames.",
      422,
    );
  const rate = String(stream.avg_frame_rate || stream.r_frame_rate || "0/0")
    .split("/")
    .map(Number);
  const declared = rate[1] ? rate[0] / rate[1] : 0;
  const timing = frameTiming(timestamps, declared);
  const duration = Math.max(
    Number(data.format?.duration) || 0,
    timing.frames[timing.frames.length - 1] + 1 / timing.fps,
  );
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1800)
    throw new MediaError("Video must be no longer than 30 minutes.", 422);
  const audio = JSON.parse(
    (
      await runBinary(process.env.FORMSYNC_FFPROBE_PATH || ffprobe.path, [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "json",
        videoPath(id),
      ])
    ).toString(),
  );
  const info: MediaInfo = {
    id,
    name,
    type,
    width,
    height,
    duration,
    fps: timing.fps,
    frames: timing.frames,
    variableFrameRate: timing.variableFrameRate,
    hasAudio: !!audio.streams?.length,
  };
  await saveMedia(info);
  return info;
}
export async function importMedia(
  file: File,
  ownerId = "local",
): Promise<MediaInfo> {
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type))
    throw new MediaError("Upload an MP4, WebM or MOV video.");
  if (!file.size || file.size > MAX_VIDEO_BYTES)
    throw new MediaError("Video must be between 1 byte and 100 MB.", 413);
  assertCapacity(file.size, ownerId);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!validVideoHeader(bytes, file.type))
    throw new MediaError("The file contents do not match the video format.");
  const id = randomUUID();
  await initStore();
  try {
    await fs.writeFile(videoPath(id), bytes, { flag: "wx" });
    setMediaOwner(id, ownerId);
    const info = await probeMedia(id, file.name.slice(0, 200), file.type);
    return info;
  } catch (e) {
    await withMediaLock(id, () => removeMedia(id));
    throw e;
  }
}
export async function decodeFrame(id: string, index: number): Promise<Buffer> {
  const info = await getMediaInfo(id);
  if (!Number.isInteger(index) || index < 0 || index >= info.frames.length)
    throw new MediaError("Frame index is out of range.");
  return runMediaProcess([
    "-v",
    "error",
    "-i",
    videoPath(id),
    "-map",
    "0:v:0",
    "-vf",
    `select=eq(n\\,${index})`,
    "-vsync",
    "0",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-f",
    "image2pipe",
    "-c:v",
    "png",
    "pipe:1",
  ]);
}
export async function trimMedia(
  original: MediaInfo,
  start: number,
  end: number,
  rotation: Rotation = 0,
  ownerId = "local",
): Promise<MediaInfo> {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > original.duration + 0.02 ||
    end - start < 0.02
  )
    throw new MediaError("Choose a valid trim range of at least 0.02 seconds.");
  const id = randomUUID();
  await initStore();
  try {
    assertCapacity(MAX_VIDEO_BYTES, ownerId);
    const range = trimFrameRange(original.frames, start, end);
    if (!range)
      throw new MediaError(
        "The selected range contains no complete video frames.",
      );
    const rotate =
      rotation === 90
        ? "transpose=1,"
        : rotation === 180
          ? "hflip,vflip,"
          : rotation === 270
            ? "transpose=2,"
            : "";
    const filters = `trim=start_frame=${range.startIndex}:end_frame=${range.endIndex},setpts=PTS-STARTPTS,${rotate}pad=ceil(iw/2)*2:ceil(ih/2)*2`;
    await runMediaProcess([
      "-v",
      "error",
      "-i",
      videoPath(original.id),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      filters,
      ...(original.hasAudio
        ? [
            "-af",
            `atrim=start=${original.frames[range.startIndex]}:end=${end},asetpts=PTS-STARTPTS`,
          ]
        : []),
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
      "-metadata:s:v:0",
      "rotate=0",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "-y",
      videoPath(id),
    ]);
    setMediaOwner(id, ownerId);
    return await probeMedia(
      id,
      original.name.replace(/\.[^.]*$/, "") + "-trimmed.mp4",
      "video/mp4",
    );
  } catch (e) {
    await withMediaLock(id, () => removeMedia(id));
    throw e;
  }
}
