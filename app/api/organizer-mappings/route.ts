import type { Entity, OrganizerMappings } from "../../types";
import { getOrganizerMappings, saveOrganizerMappings } from "../../../db/store";

export const dynamic = "force-dynamic";

const entities = new Set<Entity>(["Allegro", "eBilet", "Ceneo", "Unknown"]);

function stringArrayMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string[]> = {};
  for (const [key, rawGroupIds] of Object.entries(value)) {
    const groupIds = Array.isArray(rawGroupIds) ? rawGroupIds : [rawGroupIds];
    if (groupIds.some((groupId) => typeof groupId !== "string")) return null;
    const normalized = [...new Set((groupIds as string[]).map((groupId) => groupId.trim()).filter(Boolean))];
    if (key.trim() && normalized.length) result[key.trim()] = normalized;
  }
  return result;
}

export async function GET() {
  try {
    return Response.json(await getOrganizerMappings());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load organizer mappings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const roleToGroups = stringArrayMap(body.roleToGroups ?? body.roleToGroup);
    const rawEntityMap = stringArrayMap(body.entityToGroups ?? body.entityToGroup);
    if (!roleToGroups || !rawEntityMap || Object.keys(rawEntityMap).some((entity) => !entities.has(entity as Entity))) {
      return Response.json({ error: "Role and entity mappings must contain valid group IDs." }, { status: 400 });
    }
    const mappings: OrganizerMappings = { roleToGroups, entityToGroups: rawEntityMap };
    return Response.json(await saveOrganizerMappings(mappings));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save organizer mappings." }, { status: 500 });
  }
}
