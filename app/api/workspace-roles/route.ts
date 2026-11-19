import { getWorkspaceConfig } from "../../../lib/config";
import { getWorkspaceUser, listWorkspaceUsers, roleMember, updateWorkspaceUserRole } from "../../../lib/openai-admin";
import { validateRoleChange } from "../../../lib/workspace-roles";
import { getStoredMember, recordWorkspaceRoleChange } from "../../../db/store";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const status = (error as { status?: number })?.status;
  return Response.json({ error: status === 403 ? "OpenAI rejected this operation. Reading needs Users: Read; changing roles needs Users: Write and a workspace-owner credential." : error instanceof Error ? error.message : "Workspace roles request failed." }, { status: status && status >= 400 && status <= 599 ? status : 500 });
}
export async function GET(request: Request) {
  try {
    const config = getWorkspaceConfig({ requireAdminKey: true });
    const memberId = new URL(request.url).searchParams.get("memberId");
    if (memberId) {
      if (memberId.length > 200) return Response.json({ error: "Invalid member ID." }, { status: 400 });
      const member = await getWorkspaceUser(config.openAiBaseUrl, config.workspaceId, memberId, config.adminKey!);
      if (member.id !== memberId) throw new Error("OpenAI returned an unexpected member.");
      return Response.json(roleMember(member));
    }
    const members = await listWorkspaceUsers(config.openAiBaseUrl, config.workspaceId, config.adminKey!);
    return Response.json({ workspaceId: config.workspaceId, retrievedAt: new Date().toISOString(), members: members.map(roleMember), customRolesSupported: false });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Role changes must originate from this app." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ error: "Role changes require a JSON request." }, { status: 415 });
  let change;
  try { change = validateRoleChange(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 }); }
  try {
    const config = getWorkspaceConfig({ requireAdminKey: true });
    if (!await getStoredMember(change.memberId)) return Response.json({ error: "Sync this member into the local directory before changing their role." }, { status: 409 });
    const before = await getWorkspaceUser(config.openAiBaseUrl, config.workspaceId, change.memberId, config.adminKey!);
    if (before.id !== change.memberId || before.role !== change.expectedRole) return Response.json({ error: "The member's role changed since review. Refresh and review again." }, { status: 409 });
    if (before.role === "owner" && change.role !== "owner") {
      const members = await listWorkspaceUsers(config.openAiBaseUrl, config.workspaceId, config.adminKey!);
      if (members.filter((member) => member.role === "owner").length <= 1) return Response.json({ error: "The last workspace owner cannot be demoted." }, { status: 422 });
    }
    await updateWorkspaceUserRole(config.openAiBaseUrl, config.workspaceId, change.memberId, config.adminKey!, change.role);
    const verified = await getWorkspaceUser(config.openAiBaseUrl, config.workspaceId, change.memberId, config.adminKey!);
    if (verified.id !== change.memberId || verified.role !== change.role) throw new Error("OpenAI was updated, but the requested role could not be verified. Refresh before retrying.");
    const actor = await getChatGPTUser();
    try { await recordWorkspaceRoleChange(change.memberId, before.role, change.role, actor ? { name: actor.displayName, email: actor.email } : undefined); }
    catch { throw new Error("The role was changed and verified in OpenAI, but the local audit could not be saved. Sync the directory to reconcile; do not repeat the change."); }
    return Response.json({ ok: true, member: roleMember(verified), message: "Workspace role updated and verified. No seat or group membership changes were requested." });
  } catch (error) { return failure(error); }
}
