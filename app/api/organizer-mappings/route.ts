import type { Entity, OrganizerMappings } from "../../types";
import { getOrganizerMappings, saveOrganizerMappings } from "../../../db/store";
import { requireSameOrigin } from "../../../lib/request-safety";
import { acquireWorkspaceLock, releaseWorkspaceLock } from "../../../db/access-store";
import { getWorkspaceConfig } from "../../../lib/config";
import { accessRulesRevision } from "../../../lib/access-policy";

export const dynamic = "force-dynamic";

const entities = new Set<Entity>(["Allegro", "eBilet", "Ceneo", "Unknown"]);

function stringArrayMap(value: unknown, preserveEmpty = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string[]> = {};
  for (const [key, rawGroupIds] of Object.entries(value)) {
    const groupIds = Array.isArray(rawGroupIds) ? rawGroupIds : [rawGroupIds];
    if (groupIds.some((groupId) => typeof groupId !== "string")) return null;
    const normalized = [...new Set((groupIds as string[]).map((groupId) => groupId.trim()).filter(Boolean))];
    if (key.trim() && (normalized.length || preserveEmpty)) result[key.trim()] = normalized;
  }
  return result;
}

function validEmailDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  return domain.length > 2 && domain.length <= 253 && domain.includes(".") && /^[a-z0-9.-]+$/.test(domain);
}

export async function GET() {
  try {
    return Response.json(await getOrganizerMappings());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load organizer mappings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let lock: { workspaceId: string; owner: string } | null = null;
  try {
    requireSameOrigin(request);
    const { workspaceId } = getWorkspaceConfig();
    const owner = crypto.randomUUID();
    if (!await acquireWorkspaceLock(workspaceId, owner)) return Response.json({ error: "A sync or access operation is running. Save rules after it finishes." }, { status: 409 });
    lock = { workspaceId, owner };
    const body = await request.json() as Record<string, unknown>;
    const previous = await getOrganizerMappings();
    if (Object.hasOwn(body, "expectedRevision") && body.expectedRevision !== accessRulesRevision(previous)) return Response.json({ error: "Saved rules changed in another session. Your draft was not saved. Reload the latest rules and review your edits before saving again." }, { status: 409 });
    const roleToGroups = stringArrayMap(body.roleToGroups ?? body.roleToGroup);
    // Older clients may update legacy rules; their saves must not erase scoped rows.
    const roleToGroupsInLeaderStructure = stringArrayMap(Object.hasOwn(body, "roleToGroupsInLeaderStructure") ? body.roleToGroupsInLeaderStructure : previous.roleToGroupsInLeaderStructure ?? {}, true);
    const roleToGroupsOutsideLeaderStructure = stringArrayMap(Object.hasOwn(body, "roleToGroupsOutsideLeaderStructure") ? body.roleToGroupsOutsideLeaderStructure : previous.roleToGroupsOutsideLeaderStructure ?? {}, true);
    const rawEntityMap = stringArrayMap(body.entityToGroups ?? body.entityToGroup);
    const rawDomainMap = stringArrayMap(body.emailDomainToGroups ?? body.emailDomainToGroup ?? {});
    if (!roleToGroups || !roleToGroupsInLeaderStructure || !roleToGroupsOutsideLeaderStructure || !rawEntityMap || !rawDomainMap || Object.keys(rawEntityMap).some((entity) => !entities.has(entity as Entity)) || Object.keys(rawDomainMap).some((domain) => !validEmailDomain(domain))) {
      return Response.json({ error: "Role, entity, and email-domain mappings must contain valid values and group IDs." }, { status: 400 });
    }
    if (body.policyVersion !== 2) return Response.json({ error: "Review version 2 rules before saving." }, { status: 400 });
    // Older clients must not silently erase newly added structure rules.
    const structureRules = Object.hasOwn(body, "structureRules") ? body.structureRules : previous.structureRules ?? [];
    // Older clients must not silently erase person-specific exceptions either.
    const memberOverrides = Object.hasOwn(body, "memberOverrides") ? body.memberOverrides : previous.memberOverrides ?? {};
    const mappings: OrganizerMappings = { policyVersion: 2, roleToGroups, roleToGroupsInLeaderStructure, roleToGroupsOutsideLeaderStructure, entityToGroups: rawEntityMap, emailDomainToGroups: rawDomainMap, structureRules: structureRules as OrganizerMappings["structureRules"], memberOverrides: memberOverrides as OrganizerMappings["memberOverrides"] };
    return Response.json(await saveOrganizerMappings(mappings));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save organizer mappings." }, { status: 400 });
  } finally { if (lock) await releaseWorkspaceLock(lock.workspaceId, lock.owner); }
}
