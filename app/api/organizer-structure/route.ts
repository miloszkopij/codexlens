import { getDashboard, getOrganizerMappings } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";
import { getOrganizerStructureContext } from "../../../lib/organizer-context";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const config = getWorkspaceConfig();
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName);
    if (!dashboard) return Response.json({ error: "Sync the directory before reviewing structures." }, { status: 409 });
    const rules = await getOrganizerMappings();
    const context = await getOrganizerStructureContext(config.peopleBaseUrl, dashboard.members, rules, new URL(request.url).searchParams.get("refresh") === "1", config.managementLeaderName);
    return Response.json({ ...context, rulesKey: JSON.stringify(rules.structureRules ?? []), directoryKey: JSON.stringify(dashboard.members.map((member) => [member.id, member.email]).sort()) });
  } catch { return Response.json({ error: "Could not load reporting structures. No assignments were changed." }, { status: 502 }); }
}
