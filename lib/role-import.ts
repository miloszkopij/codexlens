export interface ImportedPermission {
  name: string;
  state: string; // Preserve API states, including future values; never infer effective access.
  editable: boolean | null;
  inheritable: boolean | null;
}
export interface ImportedRole {
  id: string; name: string; description: string | null; predefined: boolean;
  inheritsDefault: boolean; permissions: ImportedPermission[];
}
export interface RoleSnapshot {
  workspaceId: string; syncedAt: string; roles: ImportedRole[];
  groups: { id: string; name: string; roleIds: string[] }[];
}
export interface RoleImportState {
  snapshot: RoleSnapshot | null; lastAttemptAt: string | null; error: string | null;
}
export interface RoleImportResult { updated: boolean; roles: number; groups: number; message: string; }
export const emptyRoleImport: RoleImportState = { snapshot: null, lastAttemptAt: null, error: null };

export function parseImportedRole(input: unknown): ImportedRole {
  if (!input || typeof input !== "object") throw new Error("Invalid workspace role response.");
  const role = input as Record<string, unknown>;
  if (typeof role.id !== "string" || !role.id || typeof role.name !== "string" || !role.name || typeof role.predefined_role !== "boolean" || typeof role.inherits_from_default_member_role !== "boolean" || !Array.isArray(role.permission_states)) throw new Error("Incomplete workspace role response.");
  if (role.description != null && typeof role.description !== "string") throw new Error("Invalid role description.");
  const names = new Set<string>();
  const permissions = role.permission_states.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid permission state.");
    const entry = value as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name || typeof entry.state !== "string" || !entry.state || names.has(entry.name)) throw new Error("Invalid or duplicated permission state.");
    names.add(entry.name);
    return { name: entry.name, state: entry.state, editable: typeof entry.editable === "boolean" ? entry.editable : null, inheritable: typeof entry.inheritable === "boolean" ? entry.inheritable : null };
  });
  return { id: role.id, name: role.name, description: role.description as string | null | undefined ?? null, predefined: role.predefined_role, inheritsDefault: role.inherits_from_default_member_role, permissions };
}

export function roleImportError(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 401) return "Role import could not authenticate. Check the configured ChatGPT workspace Admin key.";
  if (status === 403) return "OpenAI denied reading workspace roles or group assignments. Check the Admin key’s read permissions.";
  if (status === 429) return "OpenAI rate-limited role import. Retry later; the last complete snapshot is retained.";
  return "Role import failed or returned incomplete data. The last complete snapshot is retained; retry the import.";
}
