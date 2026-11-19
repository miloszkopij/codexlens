import { acquireWorkspaceLock, readLocalSetting, releaseWorkspaceLock, writeLocalSetting } from "../../../db/access-store";
import { getDashboard } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";
import { emptyRoleGroupSettings, validateRoleGroupMappings, type RoleGroupSettings } from "../../../lib/role-group-mappings";
import { requireSameOrigin } from "../../../lib/request-safety";

export const dynamic = "force-dynamic";
export async function GET() {
  const config = getWorkspaceConfig();
  return Response.json(await readLocalSetting(`role-group-mappings:${config.workspaceId}`, emptyRoleGroupSettings));
}
export async function PATCH(request: Request) {
  const config = getWorkspaceConfig(); const owner = crypto.randomUUID(); let locked = false;
  try {
    requireSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    locked = await acquireWorkspaceLock(config.workspaceId, owner);
    if (!locked) throw new Error("Another operation is running. Retry after it finishes.");
    const key = `role-group-mappings:${config.workspaceId}`;
    const previous = await readLocalSetting<RoleGroupSettings>(key, emptyRoleGroupSettings);
    if (body.revision !== previous.revision) throw new Error("Mappings changed since loading. Reload before saving.");
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName);
    if (!dashboard) throw new Error("Sync the workspace first.");
    let roles = previous.roles;
    if (body.intent === "confirm-manually") {
      if (body.acknowledged !== true || !roles.some((role) => role.id === body.roleId)) throw new Error("Explicitly confirm an existing role mapping after checking OpenAI Admin.");
      roles = roles.map((role) => role.id === body.roleId ? { ...role, confirmedGroupIds: [...role.groupIds], confirmedAt: new Date().toISOString() } : role);
    } else if (body.intent === "save") {
      roles = validateRoleGroupMappings(body.roles, new Set(dashboard.groups.map((group) => group.id)), previous.roles);
    } else throw new Error("Choose save or manual confirmation.");
    const result: RoleGroupSettings = { revision: crypto.randomUUID(), roles };
    await writeLocalSetting(key, result);
    return Response.json(result);
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
  finally { if (locked) await releaseWorkspaceLock(config.workspaceId, owner); }
}
