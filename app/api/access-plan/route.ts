import { getDashboard, getOrganizerMappings, setStoredMembership } from "../../../db/store";
import { acquireWorkspaceLock, claimAccessPlan, releaseWorkspaceLock, renewWorkspaceLock, saveAccessPlan } from "../../../db/access-store";
import { getWorkspaceConfig } from "../../../lib/config";
import { getWorkspaceUser, listGroupUsers, listWorkspaceGroups, updateGroupMembership } from "../../../lib/openai-admin";
import { planMemberChange, reviewFingerprint, type AccessChange, type AccessOperation } from "../../../lib/access-policy";
import { requireSameOrigin } from "../../../lib/request-safety";
import { getOrganizerStructureContext } from "../../../lib/organizer-context";
import { getChatGPTUser } from "../../chatgpt-auth";
import type { WorkspaceGroup } from "../../types";

export const dynamic = "force-dynamic";
interface SavedPlan { changes: AccessChange[]; fingerprint: string; operation: AccessOperation; }
function parseOperation(value: unknown): AccessOperation {
  if (!value || typeof value !== "object") throw new Error("Choose an operation.");
  const op = value as Record<string, unknown>;
  if (op.kind === "rules") return { kind: "rules" };
  if (typeof op.groupId !== "string" || !op.groupId) throw new Error("Choose a destination group.");
  if (op.kind === "move") return { kind: "move", groupId: op.groupId };
  if (op.kind === "special" && (op.action === "add" || op.action === "remove")) return { kind: "special", groupId: op.groupId, action: op.action };
  throw new Error("Invalid membership operation.");
}
function sameIds(a: string[], b: string[]) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }

export async function POST(request: Request) {
  let lock: { workspaceId: string; owner: string } | null = null;
  try {
    requireSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const config = getWorkspaceConfig({ requireAdminKey: true });
    const key = config.adminKey as string;
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName);
    if (!dashboard) throw new Error("Sync the directory before editing memberships.");
    const rules = await getOrganizerMappings();
    if (body.intent === "preview") {
      if (!Array.isArray(body.memberIds) || !body.memberIds.length || body.memberIds.length > 100 || !body.memberIds.every((id) => typeof id === "string")) throw new Error("Choose 1–100 people per reviewed batch.");
      const operation = parseOperation(body.operation);
      const ids = new Set(body.memberIds);
      const selected = dashboard.members.filter((member) => ids.has(member.id));
      if (selected.length !== ids.size) throw new Error("A selected member is no longer in the directory. Refresh.");
      const structures = operation.kind === "rules" && selected.some((member) => !rules.memberOverrides?.[member.id]) ? (await getOrganizerStructureContext(config.peopleBaseUrl, dashboard.members, rules, true, config.managementLeaderName)).members : undefined;
      const changes: AccessChange[] = []; const blocked: { name: string; reason: string }[] = [];
      for (const member of selected) {
        try { const change = planMemberChange(member, dashboard.groups, rules, operation, structures?.[member.id]); if (change) changes.push(change); }
        catch (error) { blocked.push({ name: member.name, reason: (error as Error).message }); }
      }
      const id = crypto.randomUUID(); const expiresAt = Date.now() + 10 * 60_000;
      const changing = selected.filter((member) => changes.some((change) => change.memberId === member.id));
      const payload: SavedPlan = { changes, operation, fingerprint: reviewFingerprint(changing, dashboard.groups, rules, structures) };
      if (changes.length) await saveAccessPlan(id, config.workspaceId, payload, expiresAt);
      return Response.json({ id, expiresAt, changes, blocked, unchanged: selected.length - changes.length - blocked.length });
    }
    if (body.intent !== "apply" || typeof body.planId !== "string" || body.acknowledged !== true) throw new Error("Review and explicitly confirm the change preview.");
    const owner = crypto.randomUUID();
    if (!await acquireWorkspaceLock(config.workspaceId, owner)) return Response.json({ error: "A sync or membership operation is running. Try again after it finishes." }, { status: 409 });
    lock = { workspaceId: config.workspaceId, owner };
    const plan = await claimAccessPlan<SavedPlan>(body.planId, config.workspaceId);
    // Reload after acquiring the lock; a sync may have completed while the request waited.
    const fresh = await getDashboard(config.workspaceId, config.workspaceName);
    const freshRules = await getOrganizerMappings();
    const selected = fresh?.members.filter((member) => plan.changes.some((change) => change.memberId === member.id)) ?? [];
    const structures = fresh && plan.operation.kind === "rules" && selected.some((member) => !freshRules.memberOverrides?.[member.id]) ? (await getOrganizerStructureContext(config.peopleBaseUrl, fresh.members, freshRules, true, config.managementLeaderName)).members : undefined;
    if (!fresh || plan.fingerprint !== reviewFingerprint(selected, fresh.groups, freshRules, structures)) throw new Error("Directory, reporting structure, or rules changed since preview. No changes sent. Review again.");
    for (const member of selected) {
      const recomputed = planMemberChange(member, fresh.groups, freshRules, plan.operation, structures?.[member.id]);
      if (JSON.stringify(recomputed) !== JSON.stringify(plan.changes.find((change) => change.memberId === member.id))) throw new Error("The reviewed plan no longer matches policy.");
    }
    const remoteGroups = await listWorkspaceGroups(config.openAiBaseUrl, config.workspaceId, key);
    const liveGroups = remoteGroups.map((group) => ({ id: group.id, name: group.name, source: group.is_scim_managed || /scim|dynamic/i.test(`${group.source ?? ""} ${group.type ?? ""}`) ? "SCIM" : "Manual" })) as WorkspaceGroup[];
    if (reviewFingerprint(selected, liveGroups, freshRules, structures) !== plan.fingerprint) throw new Error("OpenAI groups changed since preview. Sync and review again.");
    const memberships = new Map<string, Set<string>>();
    for (const group of remoteGroups) {
      await renewWorkspaceLock(config.workspaceId, owner);
      memberships.set(group.id, new Set((await listGroupUsers(config.openAiBaseUrl, config.workspaceId, group.id, key)).map((user) => user.id)));
    }
    // Preflight every person before the first write.
    for (const change of plan.changes) {
      const actual = remoteGroups.filter((group) => memberships.get(group.id)?.has(change.memberId)).map((group) => group.id);
      if (!sameIds(actual, change.before)) throw new Error(`${change.name}'s OpenAI memberships changed. No changes sent; sync and review again.`);
      const user = await getWorkspaceUser(config.openAiBaseUrl, config.workspaceId, change.memberId, key);
      if (user.id !== change.memberId || user.email?.trim().toLowerCase() !== change.email.trim().toLowerCase()) throw new Error("Member identity changed. Sync before editing.");
    }
    const actor = await getChatGPTUser();
    let verified = 0; const results: { name: string; status: string; message: string }[] = [];
    for (const [index, change] of plan.changes.entries()) {
      try {
        await renewWorkspaceLock(config.workspaceId, owner);
        // Separate upstream requests are not atomic. Remove obsolete regular memberships first.
        for (const action of ["remove", "add"] as const) for (const groupId of change[action]) {
          const beforeUsers = await listGroupUsers(config.openAiBaseUrl, config.workspaceId, groupId, key);
          if (beforeUsers.some((user) => user.id === change.memberId) !== (action === "remove")) throw new Error("Membership changed during execution; review a fresh snapshot.");
          await updateGroupMembership(config.openAiBaseUrl, config.workspaceId, groupId, change.memberId, key, action);
          const afterUsers = await listGroupUsers(config.openAiBaseUrl, config.workspaceId, groupId, key);
          if (afterUsers.some((user) => user.id === change.memberId) !== (action === "add")) throw new Error("OpenAI write outcome is unverified. No automatic retry was made.");
          await setStoredMembership(change.memberId, groupId, action, actor ?? undefined);
        }
        const final: string[] = [];
        for (const group of remoteGroups) if ((await listGroupUsers(config.openAiBaseUrl, config.workspaceId, group.id, key)).some((user) => user.id === change.memberId)) final.push(group.id);
        if (!sameIds(final, change.after)) throw new Error("Final memberships differ from the preview. Sync and review before retrying.");
        verified++; results.push({ name: change.name, status: "verified", message: "Final memberships verified in OpenAI." });
      } catch (error) {
        results.push({ name: change.name, status: "uncertain", message: (error as Error).message });
        for (const skipped of plan.changes.slice(index + 1)) results.push({ name: skipped.name, status: "not-attempted", message: "Stopped after a failed or uncertain write." });
        break;
      }
    }
    return Response.json({ verified, results, message: `${verified} of ${plan.changes.length} people verified.${verified < plan.changes.length ? " Partial result: sync and create a fresh preview before retrying." : ""}` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Membership operation failed." }, { status: 409 });
  } finally { if (lock) await releaseWorkspaceLock(lock.workspaceId, lock.owner); }
}
