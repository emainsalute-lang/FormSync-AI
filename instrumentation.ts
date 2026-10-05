export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.FORMSYNC_EMBEDDED_WORKER !== "false" &&
    process.env.FORMSYNC_STORAGE_BACKEND !== "supabase" &&
    process.env.VERCEL !== "1"
  ) {
    const { startWorker } = await import("./lib/processing-worker");
    startWorker();
  }
}
