import { fetchJson } from "./http";
import { parseImportedRole, type ImportedRole, type RoleSnapshot } from "./role-import";

// ChatGPT workspace APIs, NOT API Platform /organization/roles.
async function listRoles(baseUrl: string, path: string, key: string): Promise<ImportedRole[]> {
  const roles: ImportedRole[] = []; const ids = new Set<string>(); const cursors = new Set<string>();
  let continuation: { name: string; value: string } | null = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
    if (continuation) url.searchParams.set(continuation.name, continuation.value);
    // Workerd supports manual/follow redirects, not Node's "error" mode.
    // Manual returns any redirect as a non-2xx failure without forwarding credentials.
    const raw = await fetchJson<unknown>(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual" }, 2);
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { data?: unknown }).data)) throw new Error("Incomplete role list response.");
    const page = raw as { data: unknown[]; has_more?: unknown; cursor?: unknown; next?: unknown; last_id?: unknown };
    if (page.has_more !== undefined && typeof page.has_more !== "boolean") throw new Error("Invalid role pagination.");
    for (const item of page.data) {
      const role = parseImportedRole(item);
      if (ids.has(role.id)) throw new Error("Duplicate workspace role in paginated response.");
      ids.add(role.id); roles.push(role);
    }
    // Observed ChatGPT role lists return {object,data} with no pagination fields.
    if (!page.has_more) {
      if (page.next || page.cursor) throw new Error("Ambiguous role pagination.");
      return roles;
    }
    const cursor = typeof page.cursor === "string" && page.cursor ? { name: "cursor", value: page.cursor }
      : typeof page.next === "string" && page.next ? { name: "after", value: page.next }
        : typeof page.last_id === "string" && page.last_id ? { name: "after", value: page.last_id } : null;
    if (!cursor || !page.data.length || cursors.has(cursor.value)) throw new Error("Incomplete or repeated role pagination.");
    cursors.add(cursor.value); continuation = cursor;
  }
  throw new Error("Role pagination limit exceeded.");
}

export async function fetchWorkspaceRoleSnapshot(baseUrl: string, workspaceId: string, key: string, groups: { id: string; name: string }[], heartbeat: () => Promise<void> = async () => {}) : Promise<RoleSnapshot> {
  const prefix = `/manage/workspaces/${encodeURIComponent(workspaceId)}`;
  const roles = await listRoles(baseUrl, `${prefix}/roles`, key);
  const known = new Map(roles.map((role) => [role.id, role]));
  const seenGroups = new Set<string>();
  const assignments: RoleSnapshot["groups"] = [];
  for (const group of groups) {
    if (typeof group.id !== "string" || !group.id || typeof group.name !== "string" || !group.name || seenGroups.has(group.id)) throw new Error("Invalid group directory for role import.");
    seenGroups.add(group.id);
    await heartbeat();
    const assigned = await listRoles(baseUrl, `${prefix}/groups/${encodeURIComponent(group.id)}/roles`, key);
    if (assigned.some((role) => !known.has(role.id))) throw new Error("Group references a role missing from the role directory; retry a complete import.");
    assignments.push({ id: group.id, name: group.name, roleIds: assigned.map((role) => role.id) });
  }
  return { workspaceId, syncedAt: new Date().toISOString(), roles, groups: assignments };
}
