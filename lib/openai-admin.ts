import { fetchJson } from "./http";
import { isWorkspaceRole, type WorkspaceRole, type WorkspaceRoleMember } from "./workspace-roles";

interface Page<T> { data?: T[]; has_more?: boolean; last_id?: string; cursor?: string; }
type OpenAIActor = string | {
  id?: string;
  name?: string;
  display_name?: string;
  email?: string;
  user?: { id?: string; name?: string; email?: string };
};
export interface OpenAIUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  seat_type?: string;
  status?: string;
  is_scim_managed?: boolean;
  added_at?: number | string;
  invited_at?: number | string;
  created_at?: number | string;
  added_by?: OpenAIActor;
  invited_by?: OpenAIActor;
  created_by?: OpenAIActor;
}

export function roleMember(user: OpenAIUser): WorkspaceRoleMember {
  return { id: user.id, name: user.name || user.email || "Unnamed member", email: user.email || "",
    role: isWorkspaceRole(user.role) ? user.role : "unknown",
    seatType: user.seat_type === "codex" || user.seat_type === "chatgpt" ? user.seat_type : "unknown", scimManaged: Boolean(user.is_scim_managed) };
}

export async function getWorkspaceUser(baseUrl: string, workspaceId: string, userId: string, adminKey: string) {
  return fetchJson<OpenAIUser>(`${baseUrl}/manage/workspaces/${encodeURIComponent(workspaceId)}/users/${encodeURIComponent(userId)}`, { headers: headers(adminKey) });
}

export async function updateWorkspaceUserRole(baseUrl: string, workspaceId: string, userId: string, adminKey: string, role: WorkspaceRole) {
  // Permission changes are never automatically retried after an uncertain write.
  return fetchJson<OpenAIUser>(`${baseUrl}/manage/workspaces/${encodeURIComponent(workspaceId)}/users/${encodeURIComponent(userId)}`, {
    method: "POST", headers: headers(adminKey, true), body: JSON.stringify({ role }),
  }, 1);
}
export interface OpenAIGroup { id: string; name: string; description?: string; is_scim_managed?: boolean; source?: string; type?: string; }

function normalizeTimestamp(value: number | string | undefined) {
  if (value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : null;
  const parsed = numeric === null ? new Date(value) : new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function actorDetails(value: OpenAIActor | undefined) {
  if (!value) return { name: null, email: null };
  if (typeof value === "string") return { name: value, email: value.includes("@") ? value : null };
  const nested = value.user;
  const email = value.email ?? nested?.email ?? null;
  return { name: value.name ?? value.display_name ?? nested?.name ?? email, email };
}

export function workspaceUserAddition(user: OpenAIUser) {
  const actor = actorDetails(user.added_by ?? user.invited_by ?? user.created_by);
  return {
    addedAt: normalizeTimestamp(user.added_at ?? user.invited_at ?? user.created_at),
    addedByName: actor.name,
    addedByEmail: actor.email,
    additionSource: actor.name || actor.email ? "Workspace Admin API" as const : user.is_scim_managed ? "SCIM" as const : "Directory sync" as const,
  };
}

function headers(adminKey: string, json = false) {
  return { Authorization: `Bearer ${adminKey}`, Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}) };
}

export async function listWorkspaceUsers(baseUrl: string, workspaceId: string, adminKey: string) {
  const users: OpenAIUser[] = []; let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "200" }); if (after) params.set("after", after);
    const page = await fetchJson<Page<OpenAIUser>>(`${baseUrl}/manage/workspaces/${workspaceId}/users?${params}`, { headers: headers(adminKey) });
    users.push(...(Array.isArray(page.data) ? page.data : []));
    after = page.has_more ? page.last_id : undefined;
    if (page.has_more && !after) throw new Error("Workspace user pagination returned no last_id.");
  } while (after);
  return users;
}

export async function listWorkspaceGroups(baseUrl: string, workspaceId: string, adminKey: string) {
  const groups: OpenAIGroup[] = []; let cursor: string | undefined;
  const cursors = new Set<string>(); const ids = new Set<string>();
  do {
    const params = new URLSearchParams({ limit: "100" }); if (cursor) params.set("cursor", cursor);
    const page = await fetchJson<Page<OpenAIGroup>>(`${baseUrl}/manage/workspaces/${workspaceId}/groups?${params}`, { headers: headers(adminKey) });
    if (!page || !Array.isArray(page.data) || (page.has_more !== undefined && typeof page.has_more !== "boolean")) throw new Error("Incomplete workspace group list.");
    for (const group of page.data) {
      if (!group || typeof group.id !== "string" || !group.id || typeof group.name !== "string" || !group.name || ids.has(group.id)) throw new Error("Invalid or duplicate workspace group.");
      ids.add(group.id); groups.push(group);
    }
    cursor = page.has_more ? page.cursor : undefined;
    if (page.has_more && (typeof cursor !== "string" || !cursor || !page.data.length || cursors.has(cursor) || cursors.size >= 100)) throw new Error("Incomplete or repeated workspace group pagination.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return groups;
}

export async function createWorkspaceGroup(baseUrl: string, workspaceId: string, name: string, adminKey: string) {
  return fetchJson<OpenAIGroup>(`${baseUrl}/manage/workspaces/${workspaceId}/groups`, {
    method: "POST", headers: headers(adminKey, true), body: JSON.stringify({ name }),
  }, 1);
}

export async function listGroupUsers(baseUrl: string, workspaceId: string, groupId: string, adminKey: string) {
  const users: OpenAIUser[] = []; let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100" }); if (cursor) params.set("cursor", cursor);
    const page = await fetchJson<Page<OpenAIUser>>(`${baseUrl}/manage/workspaces/${workspaceId}/groups/${encodeURIComponent(groupId)}/users?${params}`, { headers: headers(adminKey) });
    users.push(...(Array.isArray(page.data) ? page.data : []));
    cursor = page.has_more ? page.cursor : undefined;
    if (page.has_more && !cursor) throw new Error("Group member pagination returned no cursor.");
  } while (cursor);
  return users;
}

export async function updateGroupMembership(baseUrl: string, workspaceId: string, groupId: string, userId: string, adminKey: string, action: "add" | "remove") {
  if (action === "add") {
    await fetchJson(`${baseUrl}/manage/workspaces/${workspaceId}/groups/${encodeURIComponent(groupId)}/users`, {
      method: "POST", headers: headers(adminKey, true), body: JSON.stringify({ user_id: userId }),
    }, 1);
    return;
  }
  await fetchJson(`${baseUrl}/manage/workspaces/${workspaceId}/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE", headers: headers(adminKey),
  }, 1);
}
