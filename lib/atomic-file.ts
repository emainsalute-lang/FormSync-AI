import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
/** Replace a JSON record atomically, tolerating brief Windows reader/antivirus locks. */
export async function atomicWriteJson(
  destination: string,
  value: unknown,
  rename: typeof fs.rename = fs.rename,
) {
  const temporary = destination + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      flag: "wx",
    });
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, destination);
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (!["EPERM", "EACCES", "EBUSY"].includes(code || "") || attempt >= 6)
          throw e;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } finally {
    await fs.unlink(temporary).catch((e) => {
      if (e.code !== "ENOENT")
        console.error("Temporary record cleanup failed", e);
    });
  }
}
