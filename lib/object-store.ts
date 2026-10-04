import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { database, databaseDirectory } from "./database";

export const cloudEnabled = () => Boolean(process.env.FORMSYNC_S3_BUCKET);
let client: S3Client | undefined;
export function s3() {
  return client ||= new S3Client({
    region: process.env.FORMSYNC_S3_REGION || "auto",
    endpoint: process.env.FORMSYNC_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.FORMSYNC_S3_PATH_STYLE === "true",
    // Uses the SDK credential chain, including AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
  });
}
export function objectFile(key: string) {
  if (!/^(videos\/[0-9a-f-]{36}|(thumbnails|optimized)\/[0-9a-f-]{36}\.(jpg|mp4))$/i.test(key)) throw new Error("Invalid object key");
  return path.join(databaseDirectory, key);
}
export async function storeObject(key: string, mediaId: string, type: string) {
  const file = objectFile(key), {size} = await fs.stat(file);
  if (cloudEnabled()) await s3().send(new PutObjectCommand({Bucket:process.env.FORMSYNC_S3_BUCKET,Key:key,Body:createReadStream(file),ContentLength:size,ContentType:type}));
  database().prepare("INSERT INTO objects VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes,remote=excluded.remote").run(key,mediaId,size,new Date().toISOString(),cloudEnabled()?1:0);
}
const downloads = new Map<string,Promise<string>>();
export async function ensureObject(key: string): Promise<string> {
  const file = objectFile(key);
  try { await fs.access(file); return file; } catch(e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (downloads.has(key)) return downloads.get(key)!;
  const task = (async () => {
    const row = database().prepare("SELECT remote FROM objects WHERE key=?").get(key);
    if (!row?.remote || !cloudEnabled()) throw Object.assign(new Error("Video not found"),{code:"ENOENT"});
    const result = await s3().send(new GetObjectCommand({Bucket:process.env.FORMSYNC_S3_BUCKET,Key:key}));
    if (!result.Body) throw new Error("Empty cloud response");
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp = file+"."+randomUUID()+".tmp";
    try { await pipeline(result.Body as NodeJS.ReadableStream,createWriteStream(temp,{flags:"wx"})); await fs.rename(temp,file); }
    finally { await fs.unlink(temp).catch(()=>{}); }
    return file;
  })();
  downloads.set(key,task);
  try { return await task; } finally { downloads.delete(key); }
}
export async function removeObjects(mediaId: string) {
  const rows = database().prepare("SELECT key,remote FROM objects WHERE media_id=?").all(mediaId);
  for (const row of rows) {
    const key=String(row.key);
    if (row.remote) {
      if (!cloudEnabled()) throw new Error("Configure the cloud bucket before deleting cloud videos");
      await s3().send(new DeleteObjectCommand({Bucket:process.env.FORMSYNC_S3_BUCKET,Key:key}));
    }
    await fs.unlink(objectFile(key)).catch(e=>{if(e.code!=="ENOENT")throw e;});
    database().prepare("DELETE FROM objects WHERE key=?").run(key);
  }
}
