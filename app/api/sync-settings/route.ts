import { readLocalSetting, writeLocalSetting } from "../../../db/access-store";
import { getWorkspaceConfig } from "../../../lib/config";
import { defaultSyncSettings, emptySyncState, validateSyncSettings, type SyncState } from "../../../lib/sync-settings";
import { requireSameOrigin } from "../../../lib/request-safety";

export const dynamic = "force-dynamic";
export async function GET() {
  const { workspaceId } = getWorkspaceConfig();
  const settings = await readLocalSetting(`sync-settings:${workspaceId}`, defaultSyncSettings);
  const state = await readLocalSetting<SyncState>(`sync-state:${workspaceId}`, emptySyncState);
  const heartbeat = await readLocalSetting<string | null>(`sync-runner:${workspaceId}`, null);
  return Response.json({ settings, state: { ...state, runnerSeenAt: heartbeat } });
}
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const { workspaceId } = getWorkspaceConfig();
    const settings = validateSyncSettings(await request.json());
    await writeLocalSetting(`sync-settings:${workspaceId}`, settings);
    return Response.json({ settings });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
