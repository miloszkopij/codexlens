import { readLocalSetting, writeLocalSetting } from "../db/access-store";
import { fetchWorkspaceRoleSnapshot } from "./openai-roles";
import { emptyRoleImport, roleImportError, type RoleImportState, type RoleImportResult } from "./role-import";

export const roleImportKey = (workspaceId: string) => `openai-role-import:${workspaceId}`;
export async function readRoleImport(workspaceId: string) {
  return readLocalSetting<RoleImportState>(roleImportKey(workspaceId), emptyRoleImport);
}

/** Caller holds the workspace lock. Save only a fully fetched, validated snapshot. */
export async function syncWorkspaceRoles(config: { openAiBaseUrl: string; workspaceId: string; adminKey?: string }, groups: { id: string; name: string }[] | (() => Promise<{ id: string; name: string }[]>), heartbeat: () => Promise<void>): Promise<RoleImportResult> {
  const key = roleImportKey(config.workspaceId);
  const lastAttemptAt = new Date().toISOString();
  try {
    if (!config.adminKey) throw new Error("Missing Admin key.");
    const directory = typeof groups === "function" ? await groups() : groups;
    const snapshot = await fetchWorkspaceRoleSnapshot(config.openAiBaseUrl, config.workspaceId, config.adminKey, directory, heartbeat);
    await heartbeat();
    await writeLocalSetting(key, { snapshot, lastAttemptAt, error: null } satisfies RoleImportState);
    return { updated: true, roles: snapshot.roles.length, groups: snapshot.groups.length, message: `Imported ${snapshot.roles.length} OpenAI roles and assignments for ${snapshot.groups.length} groups (read-only).` };
  } catch (error) {
    const message = roleImportError(error);
    const previous = await readRoleImport(config.workspaceId);
    await heartbeat();
    await writeLocalSetting(key, { ...previous, lastAttemptAt, error: message });
    return { updated: false, roles: previous.snapshot?.roles.length ?? 0, groups: previous.snapshot?.groups.length ?? 0, message };
  }
}
