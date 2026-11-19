import { getWorkspaceConfig } from "../../../lib/config";
import { createWorkspaceGroup, listWorkspaceGroups, type OpenAIGroup } from "../../../lib/openai-admin";
import { db, initializeDatabase } from "../../../db/store";
import { acquireWorkspaceLock, releaseWorkspaceLock } from "../../../db/access-store";
import { requireSameOrigin } from "../../../lib/request-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let lock: { workspaceId: string; owner: string } | null = null;
  try {
    requireSameOrigin(request);
    const body = await request.json() as { name?: string };
    const name = body.name?.trim() ?? "";
    if (!name || name.length > 100) return Response.json({ error: "Group name must contain 1–100 characters." }, { status: 400 });

    const config = getWorkspaceConfig({ requireAdminKey: true });
    const adminKey = config.adminKey as string;
    const owner = crypto.randomUUID();
    if (!await acquireWorkspaceLock(config.workspaceId, owner)) throw new Error("A sync or membership operation is running.");
    lock = { workspaceId: config.workspaceId, owner };
    const existing = (await listWorkspaceGroups(config.openAiBaseUrl, config.workspaceId, adminKey))
      .find((group) => group.name.trim().toLowerCase() === name.toLowerCase());
    const group = existing ?? await createWorkspaceGroup(config.openAiBaseUrl, config.workspaceId, name, adminKey) as OpenAIGroup;
    if (!group.id) throw new Error("The Admin API created a group without returning its id.");
    const verified = (await listWorkspaceGroups(config.openAiBaseUrl, config.workspaceId, adminKey)).find((item) => item.id === group.id && item.name === group.name);
    if (!verified) throw new Error("Group creation could not be verified. Sync before trying again.");
    await initializeDatabase();
    await db().prepare(`INSERT INTO workspace_groups (id, name, description, source, sync_version, updated_at) VALUES (?, ?, ?, ?, 'local-create', ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, source=excluded.source, updated_at=excluded.updated_at`)
      .bind(group.id, group.name, group.description ?? "", group.is_scim_managed || /scim|dynamic/i.test(`${group.source ?? ""} ${group.type ?? ""}`) ? "SCIM" : "Manual", new Date().toISOString()).run();
    return Response.json({ group, created: !existing });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create the workspace group." }, { status: 500 });
  } finally { if (lock) await releaseWorkspaceLock(lock.workspaceId, lock.owner); }
}
