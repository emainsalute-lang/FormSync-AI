import type { Drawing, Session } from "./model";
import type { ClipEdits } from "./media-model";
import type { Workspace } from "./training";
export type DrillForm = {
  name: string;
  date: string;
  makes: number;
  misses: number;
  reps: number;
  target: number;
  durationMinutes: number | null;
  sessionRpe: number | null;
  notes: string;
  tags: string[];
};
export type DraftSnapshot = {
  version: 1;
  form: DrillForm;
  file: File | null;
  videoId: string;
  uploadId?: string;
  videoName: string;
  drawings: Drawing[];
  fps: number;
  edits: ClipEdits;
  editingId: string;
  revision: string;
  updatedAt: string;
};
export type TrainingSnapshot = {
  version: 1;
  sessions: Session[];
  workspace: Workspace;
};
const DB_NAME = "formsync-drafts";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("drafts"))
        request.result.createObjectStore("drafts");
      if (!request.result.objectStoreNames.contains("training"))
        request.result.createObjectStore("training");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function draftKey(ownerId: string) {
  return `current:${ownerId || "local"}`;
}
function trainingKey(ownerId: string) {
  return `snapshot:${ownerId || "local"}`;
}
export async function readDraft(
  ownerId = "local",
): Promise<DraftSnapshot | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readonly");
      const request = tx.objectStore("drafts").get(draftKey(ownerId));
      request.onsuccess = () =>
        resolve(request.result?.version === 1 ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function readTrainingSnapshot(
  ownerId = "local",
): Promise<TrainingSnapshot | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("training", "readonly");
      const request = tx.objectStore("training").get(trainingKey(ownerId));
      request.onsuccess = () =>
        resolve(request.result?.version === 1 ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeTrainingSnapshot(
  snapshot: TrainingSnapshot,
  ownerId = "local",
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("training", "readwrite");
      tx.objectStore("training").put(snapshot, trainingKey(ownerId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error || new Error("Training snapshot write aborted"));
    });
  } finally {
    db.close();
  }
}
let queue: Promise<void> = Promise.resolve();
export function writeDraft(
  snapshot: DraftSnapshot | null,
  ownerId = "local",
): Promise<void> {
  const operation = queue.then(async () => {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        if (snapshot) tx.objectStore("drafts").put(snapshot, draftKey(ownerId));
        else tx.objectStore("drafts").delete(draftKey(ownerId));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Draft write aborted"));
      });
    } finally {
      db.close();
    }
  });
  queue = operation.catch(() => {});
  return operation;
}
