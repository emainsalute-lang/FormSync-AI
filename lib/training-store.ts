import "server-only";
import { randomUUID } from "node:crypto";
import { migrateRecords } from "./storage";
import { readDocument, writeDocument } from "./database";
import { emptyWorkspace, workspaceSchema, type Workspace } from "./training";
import { cloudStorageEnabled } from "./cloud-config";
import { createSupabaseServerClient } from "./supabase/server";
import { checkCloud, cloudError } from "./cloud-store";
export async function readWorkspace(ownerId = "local"): Promise<Workspace> {
  if (cloudStorageEnabled()) {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("formsync_workspaces")
      .select("body")
      .eq("owner_id", ownerId)
      .maybeSingle();
    checkCloud(error);
    return workspaceSchema.parse(data?.body || emptyWorkspace());
  }
  await migrateRecords();
  const key = ownerId === "local" ? "main" : `user:${ownerId}`;
  return workspaceSchema.parse(
    readDocument("workspace", key) || emptyWorkspace(),
  );
}
export async function saveWorkspace(input: Workspace, ownerId = "local") {
  const next = { ...input, revision: randomUUID() };
  if (cloudStorageEnabled()) {
    const client = await createSupabaseServerClient();
    const row = { owner_id: ownerId, revision: next.revision, body: next };
    if (!input.revision) {
      const result = await client.from("formsync_workspaces").insert(row);
      if (result.error?.code === "23505")
        throw cloudError("Training data changed. Reload before saving.", 409);
      checkCloud(result.error);
    } else {
      const result = await client
        .from("formsync_workspaces")
        .update(row)
        .eq("owner_id", ownerId)
        .eq("revision", input.revision)
        .select("owner_id")
        .maybeSingle();
      checkCloud(result.error);
      if (!result.data)
        throw cloudError("Training data changed. Reload before saving.", 409);
    }
    return next;
  }
  await migrateRecords();
  writeDocument(
    "workspace",
    ownerId === "local" ? "main" : `user:${ownerId}`,
    next,
  );
  return next;
}
