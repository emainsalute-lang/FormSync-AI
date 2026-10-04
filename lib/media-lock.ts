import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./storage";

export async function withMediaLock<T>(
  id: string,
  operation: () => Promise<T>,
) {
  const lock = path.join(DATA_DIR, `.media-${id}.lock`);
  const deadline = Date.now() + 180000;
  while (true) {
    try {
      await fs.writeFile(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = Number(await fs.readFile(lock, "utf8"));
        if (owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (check) {
            if ((check as NodeJS.ErrnoException).code === "ESRCH") {
              await fs.unlink(lock).catch(() => {});
              continue;
            }
          }
        }
      } catch (check) {
        if ((check as NodeJS.ErrnoException).code === "ENOENT") continue;
      }
      if (Date.now() >= deadline)
        throw new Error("Video is busy. Please retry this operation.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await operation();
  } finally {
    await fs.unlink(lock);
  }
}
