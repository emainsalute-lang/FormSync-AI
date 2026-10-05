import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import ffprobe from "ffprobe-static";
import { createSupabaseServerClient } from "./supabase/server";
import { VIDEO_BUCKET } from "./cloud-config";
import {
  checkCloud,
  cloudError,
  cloudMedia,
  mediaObject,
  type CloudMedia,
} from "./cloud-store";
import { runBinary, runMediaProcess } from "./media-service";
import { frameTiming, type MediaInfo } from "./media-model";
import { trimFrameRange, type Rotation } from "./media-model";
import { randomUUID } from "node:crypto";
import { validVideoHeader } from "./validation";

async function scratch<T>(work: (directory: string) => Promise<T>) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "formsync-video-"));
  try {
    return await work(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
async function download(row: CloudMedia, directory: string, original = false) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.storage
    .from(VIDEO_BUCKET)
    .download(mediaObject(row, original ? "original" : "playback.mp4"));
  checkCloud(error);
  if (
    !data ||
    data.size > 100 * 1024 * 1024 ||
    (original && data.size !== row.size)
  )
    throw cloudError("Video upload is incomplete or too large.", 422);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!validVideoHeader(bytes, original ? row.type : "video/mp4"))
    throw cloudError("File contents do not match the video format.", 422);
  const file = path.join(directory, "input");
  await fs.writeFile(file, bytes);
  return file;
}
async function probe(file: string, row: CloudMedia): Promise<MediaInfo> {
  const result = JSON.parse(
    (
      await runBinary(process.env.FORMSYNC_FFPROBE_PATH || ffprobe.path, [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream:format=duration:frame=best_effort_timestamp_time",
        "-of",
        "json",
        file,
      ])
    ).toString(),
  );
  const stream = result.streams?.[0];
  if (
    !stream ||
    !stream.width ||
    !stream.height ||
    stream.width * stream.height > 16000000
  )
    throw cloudError(
      "Video has no supported picture or exceeds 16 megapixels.",
      422,
    );
  const frames: number[] = (result.frames || [])
    .map((frame: { best_effort_timestamp_time?: string }) =>
      Number(frame.best_effort_timestamp_time),
    )
    .filter(Number.isFinite);
  if (!frames.length || frames.length > 250000)
    throw cloudError("Video has no supported frames or is too long.", 422);
  const [numerator, denominator] = String(stream.avg_frame_rate || "30/1")
    .split("/")
    .map(Number);
  const timing = frameTiming(frames, numerator / denominator);
  const duration = Math.max(
    Number(result.format?.duration) || 0,
    timing.frames.at(-1)! + 1 / timing.fps,
  );
  if (!Number.isFinite(duration) || duration > 1800 || duration <= 0)
    throw cloudError("Video must be no longer than 30 minutes.", 422);
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
        file,
      ])
    ).toString(),
  );
  return {
    id: row.id,
    name: row.name,
    type: "video/mp4",
    width: stream.width,
    height: stream.height,
    duration,
    ...timing,
    hasAudio: Boolean(audio.streams?.length),
  };
}
export async function processCloudUpload(id: string) {
  let playbackSize = 0;
  const client = await createSupabaseServerClient();
  const row = await cloudMedia(id);
  if (row.state === "ready" || row.state === "cancelled") return row;
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const claimed = await client
    .from("formsync_media")
    .update({ state: "processing", error: null, lease_until: lease })
    .eq("id", id)
    .or(
      `state.eq.uploading,state.eq.failed,and(state.eq.processing,lease_until.lt.${now})`,
    )
    .select("id")
    .maybeSingle();
  checkCloud(claimed.error);
  if (!claimed.data) return cloudMedia(id);
  try {
    const info = await scratch(async (directory) => {
      const input = await download(row, directory, true);
      // Probe before transcoding to reject unsupported dimensions/duration early.
      await probe(input, row);
      const output = path.join(directory, "playback.mp4");
      await runMediaProcess([
        "-v",
        "error",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=w='min(1280,iw)':h=-2,pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "25",
        "-pix_fmt",
        "yuv420p",
        "-vsync",
        "0",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-y",
        output,
      ]);
      playbackSize = (await fs.stat(output)).size;
      if (playbackSize > 100 * 1024 * 1024)
        throw cloudError(
          "Converted video exceeds 100 MB. Try a shorter clip.",
          422,
        );
      const metadata = await probe(output, row);
      const saved = await client.storage
        .from(VIDEO_BUCKET)
        .upload(mediaObject(row), await fs.readFile(output), {
          contentType: "video/mp4",
          upsert: true,
        });
      checkCloud(saved.error);
      return metadata;
    });
    checkCloud(
      (
        await client
          .from("formsync_media")
          .update({
            state: "ready",
            info,
            error: null,
            lease_until: null,
            playback_size: playbackSize,
          })
          .eq("id", id)
          .eq("lease_until", lease)
      ).error,
    );
  } catch (error) {
    await client
      .from("formsync_media")
      .update({
        state: "failed",
        error:
          error instanceof Error ? error.message : "Video processing failed.",
        lease_until: null,
      })
      .eq("id", id)
      .eq("lease_until", lease);
  }
  return cloudMedia(id);
}
export async function cloudFrame(id: string, index: number) {
  const row = await cloudMedia(id);
  if (
    !row.info ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= row.info.frames.length
  )
    throw cloudError("Frame index is out of range.", 400);
  return scratch(async (directory) => {
    const file = await download(row, directory);
    return runMediaProcess([
      "-v",
      "error",
      "-i",
      file,
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
  });
}
export async function transformCloudVideo(
  original: CloudMedia,
  start: number,
  end: number,
  rotation: Rotation,
) {
  const info = original.info!;
  const range = trimFrameRange(info.frames, start, end);
  if (!range)
    throw cloudError("The selected range has no complete frames.", 400);
  const client = await createSupabaseServerClient();
  const row: CloudMedia = {
    ...original,
    id: randomUUID(),
    name: original.name.replace(/\.[^.]*$/, "") + "-trimmed.mp4",
    type: "video/mp4",
    state: "processing",
    info: null,
    size: 1,
    playback_size: 0,
    has_original: false,
  };
  checkCloud(
    (
      await client.from("formsync_media").insert({
        id: row.id,
        owner_id: row.owner_id,
        name: row.name,
        type: row.type,
        size: 1,
        has_original: false,
        state: "processing",
      })
    ).error,
  );
  try {
    const metadata = await scratch(async (directory) => {
      const input = await download(original, directory);
      const output = path.join(directory, "trim.mp4");
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
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        filters,
        ...(info.hasAudio
          ? [
              "-af",
              `atrim=start=${info.frames[range.startIndex]}:end=${end},asetpts=PTS-STARTPTS`,
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
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-y",
        output,
      ]);
      const bytes = await fs.readFile(output);
      if (bytes.length > 100 * 1024 * 1024)
        throw cloudError("Trimmed video exceeds 100 MB.", 422);
      row.size = bytes.length;
      const metadata = await probe(output, row);
      checkCloud(
        (
          await client.storage
            .from(VIDEO_BUCKET)
            .upload(mediaObject(row), bytes, { contentType: "video/mp4" })
        ).error,
      );
      return metadata;
    });
    checkCloud(
      (
        await client
          .from("formsync_media")
          .update({ state: "ready", info: metadata, size: row.size })
          .eq("id", row.id)
      ).error,
    );
    return { ...row, state: "ready", info: metadata };
  } catch (error) {
    await client.storage.from(VIDEO_BUCKET).remove([mediaObject(row)]);
    await client.from("formsync_media").delete().eq("id", row.id);
    throw error;
  }
}
