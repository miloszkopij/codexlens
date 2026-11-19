import { acquireWorkspaceLock, releaseWorkspaceLock, renewWorkspaceLock } from "../../../db/access-store";
import { getWorkspaceConfig } from "../../../lib/config";
import { listWorkspaceGroups } from "../../../lib/openai-admin";
import { readRoleImport, syncWorkspaceRoles } from "../../../lib/role-sync";
import { requireSameOrigin } from "../../../lib/request-safety";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await readRoleImport(getWorkspaceConfig().workspaceId)); }
  catch { return Response.json({ error: "Could not read the saved role import." }, { status: 500 }); }
}
// POST triggers local import only. All upstream requests remain GETs.
export async function POST(request: Request) {
  try { requireSameOrigin(request); }
  catch { return Response.json({ error: "Cross-origin imports are not permitted." }, { status: 403 }); }
  let lock: { workspaceId: string; owner: string } | null = null;
  try {
    const config = getWorkspaceConfig({ requireAdminKey: true }); const owner = crypto.randomUUID();
    if (!await acquireWorkspaceLock(config.workspaceId, owner)) return Response.json({ error: "A sync or access operation is running. Retry after it finishes." }, { status: 409 });
    lock = { workspaceId: config.workspaceId, owner };
    const result = await syncWorkspaceRoles(config, () => listWorkspaceGroups(config.openAiBaseUrl, config.workspaceId, config.adminKey!), () => renewWorkspaceLock(config.workspaceId, owner));
    return Response.json({ ...await readRoleImport(config.workspaceId), result }, { status: result.updated ? 200 : 502 });
  } catch { return Response.json({ error: "Role import could not complete. Check the connection and Admin key; the previous snapshot is unchanged." }, { status: 502 }); }
  finally { if (lock) await releaseWorkspaceLock(lock.workspaceId, lock.owner); }
}
