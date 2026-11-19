export interface RoleGroupMapping {
  id: string; name: string; externalId: string; groupIds: string[];
  confirmedGroupIds: string[] | null; confirmedAt: string | null;
}
export interface RoleGroupSettings { revision: string; roles: RoleGroupMapping[]; }
export const emptyRoleGroupSettings: RoleGroupSettings = { revision: "", roles: [] };
export function mappingNeedsAction(role: RoleGroupMapping) {
  return !role.confirmedAt || JSON.stringify([...role.groupIds].sort()) !== JSON.stringify([...(role.confirmedGroupIds ?? [])].sort());
}
export function validateRoleGroupMappings(value: unknown, groupIds: Set<string>, previous: RoleGroupMapping[]): RoleGroupMapping[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Register up to 100 existing OpenAI roles.");
  const ids = new Set<string>(); const names = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || item.id.length > 100 || ids.has(item.id)) throw new Error("Each role reference needs a unique identifier.");
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 100 || names.has(item.name.trim().toLowerCase())) throw new Error("Use unique existing role names, up to 100 characters.");
    if (typeof item.externalId !== "string" || item.externalId.length > 200) throw new Error("Invalid OpenAI role ID.");
    if (!Array.isArray(item.groupIds) || item.groupIds.some((id: unknown) => typeof id !== "string" || !groupIds.has(id))) throw new Error("Choose groups in the current directory.");
    ids.add(item.id); names.add(item.name.trim().toLowerCase());
    const old = previous.find((role) => role.id === item.id);
    const unchangedIdentity = old?.name === item.name.trim() && old?.externalId === item.externalId.trim();
    return { id: item.id, name: item.name.trim(), externalId: item.externalId.trim(), groupIds: [...new Set<string>(item.groupIds)].sort(),
      confirmedGroupIds: unchangedIdentity ? old?.confirmedGroupIds ?? null : null, confirmedAt: unchangedIdentity ? old?.confirmedAt ?? null : null };
  });
}
