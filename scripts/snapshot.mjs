import { promises as fs, createReadStream } from "node:fs";
import { DatabaseSync, backup } from "node:sqlite";
import path from "node:path";
import crypto from "node:crypto";
export const safeEntry = (file) =>
  /^(formsync\.sqlite|workspace\.json|(sessions|metadata)\/[0-9a-f-]{36}\.json|videos\/[0-9a-f-]{36}|(thumbnails|optimized)\/[0-9a-f-]{36}\.(jpg|mp4))$/i.test(
    file,
  );
export async function checksum(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
/** @param {string} source @param {string} destination @param {(key:string)=>Promise<unknown>} hydrate */
export async function snapshotDatabase(
  source,
  destination,
  hydrate = async (_key) => {},
) {
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length)
    throw new Error("Backup destination must be empty");
  const db = new DatabaseSync(path.join(source, "formsync.sqlite"));
  try {
    await backup(db, path.join(destination, "formsync.sqlite"));
  } finally {
    db.close();
  }
  const copyDb = new DatabaseSync(path.join(destination, "formsync.sqlite"), {
    readOnly: true,
  });
  let keys;
  try {
    if (copyDb.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Database integrity check failed");
    keys = copyDb
      .prepare("SELECT key FROM objects")
      .all()
      .map((r) => String(r.key));
  } finally {
    copyDb.close();
  }
  const files = {
    "formsync.sqlite": await checksum(
      path.join(destination, "formsync.sqlite"),
    ),
  };
  for (const key of keys) {
    if (!safeEntry(key)) throw new Error("Unsafe object key");
    await hydrate(key);
    const dest = path.join(destination, key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(source, key), dest, fs.constants.COPYFILE_EXCL);
    files[key] = await checksum(dest);
  }
  const manifest = {
    format: "formsync-backup-v2",
    createdAt: new Date().toISOString(),
    files,
  };
  await fs.writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
export async function restoreSnapshot(snapshot, destination) {
  const existing = await fs.readdir(destination).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  if (existing.length)
    throw new Error(
      "Restore requires an empty data directory; existing data will not be overwritten.",
    );
  const manifest = JSON.parse(
    await fs.readFile(path.join(snapshot, "manifest.json"), "utf8"),
  );
  if (!["formsync-backup-v1", "formsync-backup-v2"].includes(manifest.format))
    throw new Error("Unknown backup format");
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!safeEntry(file) || typeof hash !== "string")
      throw new Error("Unsafe backup entry");
    if ((await checksum(path.join(snapshot, file))) !== hash)
      throw new Error("Backup checksum failed: " + file);
  }
  if (manifest.format === "formsync-backup-v2") {
    if (!manifest.files["formsync.sqlite"])
      throw new Error("Database missing from snapshot");
    const db = new DatabaseSync(path.join(snapshot, "formsync.sqlite"), {
      readOnly: true,
    });
    try {
      if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
        throw new Error("Database integrity check failed");
      for (const r of db.prepare("SELECT key FROM objects").all())
        if (!manifest.files[String(r.key)])
          throw new Error("Snapshot is missing a video object");
    } finally {
      db.close();
    }
  }
  await fs.mkdir(destination, { recursive: true });
  for (const file of Object.keys(manifest.files)) {
    const dest = path.join(destination, file);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(
      path.join(snapshot, file),
      dest,
      fs.constants.COPYFILE_EXCL,
    );
  }
  if (manifest.format === "formsync-backup-v2") {
    const db = new DatabaseSync(path.join(destination, "formsync.sqlite"));
    try {
      db.exec(
        "UPDATE jobs SET state='failed',lease_until=0,error='Cancelled during recovery; retry if needed' WHERE state IN ('queued','running'); UPDATE uploads SET state='cancelled',error='Incomplete upload excluded from backup' WHERE state IN ('uploading','queued','processing');",
      );
      db.exec("UPDATE objects SET remote=0;");
    } finally {
      db.close();
    }
  }
  return manifest;
}
