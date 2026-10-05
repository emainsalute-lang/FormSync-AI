import path from "node:path";

export function resolveDataDirectory(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
) {
  return path.resolve(cwd, env.FORMSYNC_DATA_DIR || "data");
}

export function assertPersistentStorage(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
) {
  if (env.VERCEL === "1" || env.AWS_LAMBDA_FUNCTION_NAME || cwd === "/var/task")
    throw Object.assign(
      new Error(
        "This deployment cannot save videos or sessions to local storage. Run FormSync on a Node server with a persistent writable disk and set FORMSYNC_DATA_DIR to its mounted directory. Serverless temporary storage cannot reliably retain sessions or resume uploads.",
      ),
      { status: 503 },
    );
}

export const dataDirectory = resolveDataDirectory();
