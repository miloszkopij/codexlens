import type { Member } from "../app/types";

export const workspaceRoles = ["member", "analytics_viewer", "admin", "owner"] as const;
export type WorkspaceRole = typeof workspaceRoles[number];
export const workspaceRoleLabels: Record<WorkspaceRole, string> = { member: "Member", analytics_viewer: "Analytics Viewer", admin: "Admin", owner: "Owner" };
export const workspaceRoleDescriptions: Record<WorkspaceRole, string> = {
  member: "No workspace administration rights. Product features depend on seat and workspace permissions.",
  analytics_viewer: "Workspace analytics access. Does not grant workspace ownership.",
  admin: "Workspace administration, including supported member and group management.",
  owner: "Workspace-wide settings, member role changes and role-based access configuration.",
};
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && workspaceRoles.includes(value as WorkspaceRole);
}
export function displayWorkspaceRole(value: string): Member["workspaceRole"] {
  const role = value.toLowerCase();
  return isWorkspaceRole(role) ? workspaceRoleLabels[role] as Member["workspaceRole"] : "Unknown";
}
export interface WorkspaceRoleMember {
  id: string; name: string; email: string; role: WorkspaceRole | "unknown";
  seatType: "chatgpt" | "codex" | "unknown"; scimManaged: boolean;
}
export interface WorkspaceRolesData {
  workspaceId: string; retrievedAt: string; members: WorkspaceRoleMember[];
  customRolesSupported: false;
}

export function validateRoleChange(input: unknown): { memberId: string; role: WorkspaceRole; expectedRole: WorkspaceRole } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provide a reviewed role change.");
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["memberId", "role", "expectedRole"].includes(key))) throw new Error("Only built-in role changes are supported; seats and custom permissions cannot be changed here.");
  if (typeof body.memberId !== "string" || !body.memberId.trim() || body.memberId.length > 200) throw new Error("Choose an accepted workspace member.");
  if (!isWorkspaceRole(body.role) || !isWorkspaceRole(body.expectedRole)) throw new Error("Choose a supported built-in workspace role.");
  if (body.role === body.expectedRole) throw new Error("This member already has the requested role.");
  return { memberId: body.memberId, role: body.role, expectedRole: body.expectedRole };
}
