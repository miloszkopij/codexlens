import { fetchJson } from "./http";

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
  status?: string;
  is_scim_managed?: boolean;
  added_at?: number | string;
  invited_at?: number | string;
  created_at?: number | string;
  added_by?: OpenAIActor;
  invited_by?: OpenAIActor;
  created_by?: OpenAIActor;
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
  do {
    const params = new URLSearchParams({ limit: "100" }); if (cursor) params.set("cursor", cursor);
    const page = await fetchJson<Page<OpenAIGroup>>(`${baseUrl}/manage/workspaces/${workspaceId}/groups?${params}`, { headers: headers(adminKey) });
    groups.push(...(Array.isArray(page.data) ? page.data : []));
    cursor = page.has_more ? page.cursor : undefined;
    if (page.has_more && !cursor) throw new Error("Workspace group pagination returned no cursor.");
  } while (cursor);
  return groups;
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
    });
    return;
  }
  await fetchJson(`${baseUrl}/manage/workspaces/${workspaceId}/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE", headers: headers(adminKey),
  });
}
