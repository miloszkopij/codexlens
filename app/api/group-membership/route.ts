import { getStoredGroup, getStoredMember, setStoredMembership } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";
import { listGroupUsers, updateGroupMembership } from "../../../lib/openai-admin";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { memberId?: string; groupId?: string; action?: string };
    if (!body.memberId || !body.groupId || (body.action !== "add" && body.action !== "remove")) {
      return Response.json({ error: "memberId, groupId and a valid action are required." }, { status: 400 });
    }
    const [group, member] = await Promise.all([getStoredGroup(body.groupId), getStoredMember(body.memberId)]);
    if (!group || !member) return Response.json({ error: "The selected member or group is not in the latest snapshot." }, { status: 404 });
    if (group.source === "SCIM") return Response.json({ error: "This group is SCIM-managed. Update its membership in your identity provider." }, { status: 409 });

    const config = getWorkspaceConfig({ requireAdminKey: true });
    const adminKey = config.adminKey as string;
    await updateGroupMembership(config.openAiBaseUrl, config.workspaceId, group.id, member.id, adminKey, body.action);
    const verifiedUsers = await listGroupUsers(config.openAiBaseUrl, config.workspaceId, group.id, adminKey);
    const isMember = verifiedUsers.some((user) => user.id === member.id);
    if ((body.action === "add" && !isMember) || (body.action === "remove" && isMember)) {
      throw new Error("OpenAI accepted the request, but the membership could not be verified.");
    }
    const actor = await getChatGPTUser();
    await setStoredMembership(member.id, group.id, body.action, actor ? { name: actor.displayName, email: actor.email } : undefined);
    return Response.json({ ok: true, message: `${member.name} was ${body.action === "add" ? "added to" : "removed from"} ${group.name} and the result was verified.` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Group membership update failed." }, { status: 500 });
  }
}
