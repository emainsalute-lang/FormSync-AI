import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { databaseDirectory } from "./database";
import { ensureObject } from "./object-store";
import { readWorkspace } from "./training-store";
import { listSessions, withStoreLock } from "./storage";
import { storagePolicy } from "./storage-policy";

type Manifest = {
  format: "formsync-backup-v1";
  createdAt: string;
  files: Record<string, string>;
};

async function digest(file: string) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function copySnapshotFile(
  source: string,
  destination: string,
  relative: string,
  files: Record<string, string>,
) {
  const target = path.join(destination, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  files[relative.replaceAll("\\", "/")] = await digest(target);
}

async function removeOldSnapshots(root: string, keep: number) {
  const entries = (await fs.readdir(root, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && /^formsync-[\w-]+$/.test(entry.name),
    )
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries.slice(keep)) {
    const dir = path.join(root, entry.name);
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
      ) as Partial<Manifest>;
      if (manifest.format === "formsync-backup-v1")
        await fs.rm(dir, { recursive: true, force: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("Could not prune old backup", dir, error);
    }
  }
}

export async function createSnapshot() {
  return withStoreLock(async () => {
    const root = path.resolve(
      process.env.FORMSYNC_BACKUP_DIR ||
        path.join(databaseDirectory, "backups"),
    );
    await fs.mkdir(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const name = `formsync-${stamp}-${randomUUID()}`;
    const destination = path.join(root, name);
    const temporary = path.join(root, `.${name}.tmp`);
    const files: Record<string, string> = {};
    try {
      await fs.mkdir(temporary);
      const sessions = await listSessions();
      const workspace = await readWorkspace();
      const videos = new Set<string>();
      for (const session of sessions) {
        if (
          !/^[0-9a-f-]{36}$/i.test(session.id) ||
          !/^[0-9a-f-]{36}$/i.test(session.videoId)
        )
          throw new Error("Invalid session record in backup source");
        const relative = `sessions/${session.id}.json`;
        const serialized = path.join(temporary, relative);
        await fs.mkdir(path.dirname(serialized), { recursive: true });
        await fs.writeFile(serialized, JSON.stringify(session), {
          flag: "wx",
        });
        files[relative] = await digest(serialized);
        videos.add(session.videoId);
      }
      for (const id of videos) {
        const source = await ensureObject(`videos/${id}`);
        await copySnapshotFile(source, temporary, `videos/${id}`, files);
        const metadata = path.join(databaseDirectory, "metadata", `${id}.json`);
        try {
          await copySnapshotFile(
            metadata,
            temporary,
            `metadata/${id}.json`,
            files,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const workspacePath = path.join(temporary, "workspace.json");
      await fs.writeFile(workspacePath, JSON.stringify(workspace), {
        flag: "wx",
      });
      files["workspace.json"] = await digest(workspacePath);
      const manifest: Manifest = {
        format: "formsync-backup-v1",
        createdAt: new Date().toISOString(),
        files,
      };
      await fs.writeFile(
        path.join(temporary, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        { flag: "wx" },
      );
      await fs.rename(temporary, destination);
      const keep = storagePolicy().backupKeep;
      await removeOldSnapshots(
        root,
        Number.isSafeInteger(keep) && keep > 0 ? keep : 7,
      );
      return destination;
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  });
}
