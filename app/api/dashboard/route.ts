import { demoData } from "../../demo-data";
import { getDashboard } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getWorkspaceConfig();
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName);
    return Response.json(dashboard ?? demoData);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the dashboard." }, { status: 500 });
  }
}
