import { getAnalytics, getDashboard } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";
import { findPersonByDisplayName, getDirectorySnapshot, profileId } from "../../../lib/people-api";
import { listWorkspaceUsers, roleMember } from "../../../lib/openai-admin";
import { calculateStructureCoverage, type StructureCoverageData } from "../../../lib/structure-coverage";
import type { Entity } from "../../types";

export const dynamic = "force-dynamic";
function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const startDate = params.get("start"); const endDate = params.get("end");
  const entity = params.get("entity") || null; const groupId = params.get("group") || null;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || (entity && !["Allegro", "eBilet", "Ceneo", "Unknown"].includes(entity))) return Response.json({ error: "Select valid dates and entity." }, { status: 400 });
  try {
    const config = getWorkspaceConfig({ requireAdminKey: true });
    const [directory, anchorResult, workspaceUsers, analytics, dashboard] = await Promise.all([
      getDirectorySnapshot(config.peopleBaseUrl), findPersonByDisplayName(config.peopleBaseUrl, config.managementLeaderName),
      listWorkspaceUsers(config.openAiBaseUrl, config.workspaceId, config.adminKey!),
      getAnalytics({ startDate, endDate, bucket: "day" }), getDashboard(config.workspaceId, config.workspaceName),
    ]);
    if (anchorResult.match !== "Matched" || !anchorResult.profile) throw new Error("The default N-1 leader could not be uniquely identified in People API.");
    const anchorId = profileId(anchorResult.profile);
    const anchor = directory.people.find((person) => profileId(person) === anchorId);
    const rootId = profileId(anchor?.manager);
    const root = directory.people.find((person) => profileId(person) === rootId);
    if (!anchor || !anchorId || !root || !rootId) throw new Error("People API did not provide the default leader's parent manager. N-1 structures cannot be inferred from job titles.");
    const group = groupId ? dashboard?.groups.find((item) => item.id === groupId) : null;
    if (groupId && !group) return Response.json({ error: "Selected group is not in the current snapshot. Sync the directory." }, { status: 400 });
    const groupMemberIds = groupId ? new Set(dashboard!.members.filter((member) => member.groupIds?.includes(groupId)).map((member) => member.id)) : null;
    const result = calculateStructureCoverage({ people: directory.people, rootId, members: workspaceUsers.map(roleMember), activeUserIds: new Set(analytics.byUser.filter((row) => row.usage > 0 || row.messages > 0).map((row) => row.id)), entity: entity as Entity | null, groupMemberIds });
    const payload: StructureCoverageData = { ...result, root: { id: rootId, name: root.displayName ?? "Root manager" }, anchor: { id: anchorId, name: anchor.displayName ?? config.managementLeaderName },
      startDate, endDate, peopleAsOf: directory.retrievedAt, workspaceAsOf: new Date().toISOString(), usageSource: analytics.source,
      entity: entity as Entity | null, groupId, groupName: group?.name ?? null };
    return Response.json(payload);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Structure coverage could not be loaded." }, { status: 500 }); }
}
