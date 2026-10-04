import "server-only";
import { randomUUID } from "node:crypto";
import { migrateRecords } from "./storage";
import { readDocument, writeDocument } from "./database";
import { emptyWorkspace, workspaceSchema, type Workspace } from "./training";
export async function readWorkspace(ownerId = "local"): Promise<Workspace> {await migrateRecords();const key=ownerId==="local"?"main":`user:${ownerId}`;return workspaceSchema.parse(readDocument("workspace",key)||emptyWorkspace());}
export async function saveWorkspace(input: Workspace,ownerId = "local") {await migrateRecords();const next={...input,revision:randomUUID()};writeDocument("workspace",ownerId==="local"?"main":`user:${ownerId}`,next);return next;}
