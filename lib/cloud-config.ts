export function cloudStorageEnabled() {
  return (
    process.env.FORMSYNC_STORAGE_BACKEND === "supabase" ||
    (process.env.VERCEL === "1" &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL))
  );
}
export const VIDEO_BUCKET = "formsync-videos";
