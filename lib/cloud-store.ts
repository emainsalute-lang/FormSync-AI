import "server-only";
import { createSupabaseServerClient } from "./supabase/server";
import { VIDEO_BUCKET } from "./cloud-config";
import type { MediaInfo } from "./media-model";
import type { Session } from "./model";

export function cloudError(message: string, status = 503) {
  return Object.assign(new Error(message), { status });
}
export function checkCloud(error: { message: string; code?: string } | null) {
  if (error?.code === "PGRST205" || error?.code === "42P01")
    throw cloudError(
      "Supabase storage tables are missing. Run migrations 001 and 002 in Supabase SQL Editor.",
    );
  if (error) throw cloudError(error.message);
}
export type CloudMedia = {
  id: string;
  owner_id: string;
  name: string;
  type: string;
  size: number;
  playback_size?: number;
  has_original?: boolean;
  state: string;
  error: string | null;
  info: MediaInfo | null;
  created_at: string;
};
export const mediaObject = (row: CloudMedia, file = "playback.mp4") =>
  `${row.owner_id}/${row.id}/${file}`;
export async function cloudMedia(id: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("formsync_media")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  checkCloud(error);
  if (!data) throw cloudError("Video not found.", 404);
  return data as CloudMedia;
}
export async function cloudSessions(ownerId?: string, owners: string[] = []) {
  const client = await createSupabaseServerClient();
  let query = client.from("formsync_sessions").select("body");
  if (ownerId) query = query.in("owner_id", [...new Set([ownerId, ...owners])]);
  const { data, error } = await query;
  checkCloud(error);
  return (data || [])
    .map((row) => row.body as Session)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
}
export async function cloudSession(
  id: string,
  ownerId?: string,
  owners: string[] = [],
) {
  return (
    (await cloudSessions(ownerId, owners)).find((row) => row.id === id) || null
  );
}
export async function cloudVideoUrl(id: string) {
  const row = await cloudMedia(id);
  if (row.state !== "ready") throw cloudError("Video is not ready yet.", 409);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(mediaObject(row), 3600);
  checkCloud(error);
  return data!.signedUrl;
}
export async function removeUnusedCloudVideo(id: string) {
  const client = await createSupabaseServerClient();
  const linked = await client
    .from("formsync_sessions")
    .select("id")
    .eq("media_id", id)
    .limit(1);
  checkCloud(linked.error);
  if (linked.data?.length) return;
  const row = await cloudMedia(id);
  // The database trigger prevents cancellation if a concurrent save linked it.
  const cancelled = await client
    .from("formsync_media")
    .update({ state: "cancelled" })
    .eq("id", id)
    .eq("state", "ready")
    .select("id")
    .maybeSingle();
  checkCloud(cancelled.error);
  if (!cancelled.data) return;
  checkCloud(
    (
      await client.storage
        .from(VIDEO_BUCKET)
        .remove([mediaObject(row, "original"), mediaObject(row)])
    ).error,
  );
  checkCloud((await client.from("formsync_media").delete().eq("id", id)).error);
}
export async function cloudUploadStatus(row: CloudMedia) {
  const client = await createSupabaseServerClient();
  let token: string | undefined;
  if (row.state === "uploading") {
    const signed = await client.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(mediaObject(row, "original"), { upsert: true });
    checkCloud(signed.error);
    token = signed.data!.token;
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const host = new URL(base);
  if (host.hostname.endsWith(".supabase.co"))
    host.hostname = host.hostname.replace(
      ".supabase.co",
      ".storage.supabase.co",
    );
  return {
    ...row,
    offset: row.state === "uploading" ? 0 : row.size,
    media: row.info,
    cloud: {
      token,
      endpoint: new URL("/storage/v1/upload/resumable", host).toString(),
      bucket: VIDEO_BUCKET,
      object: mediaObject(row, "original"),
    },
  };
}
