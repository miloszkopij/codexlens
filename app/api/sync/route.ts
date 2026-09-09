import type { Member } from "../../types";
import { getDashboard, importUsage, saveFailedSync, saveSnapshot } from "../../../db/store";
import { codexAnalyticsError, listDailyCodexUsage } from "../../../lib/codex-analytics";
import { getWorkspaceConfig } from "../../../lib/config";
import { mapWithConcurrency } from "../../../lib/http";
import { listGroupUsers, listWorkspaceGroups, listWorkspaceUsers, workspaceUserAddition } from "../../../lib/openai-admin";
import { entityFromCompany, findPersonByEmail } from "../../../lib/people-api";

export const dynamic = "force-dynamic";

export async function POST() {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  try {
    const config = getWorkspaceConfig({ requireAdminKey: true });
    const adminKey = config.adminKey as string;
    const [openAiUsers, openAiGroups] = await Promise.all([
      listWorkspaceUsers(config.openAiBaseUrl, config.workspaceId, adminKey),
      listWorkspaceGroups(config.openAiBaseUrl, config.workspaceId, adminKey),
    ]);

    const groupMembers = new Map<string, string[]>();
    for (const group of openAiGroups) {
      const users = await listGroupUsers(config.openAiBaseUrl, config.workspaceId, group.id, adminKey);
      groupMembers.set(group.id, users.map((user) => user.id));
    }

    const enriched = await mapWithConcurrency(openAiUsers, 8, async (user) => {
      const email = String(user.email ?? "").trim();
      let result: Awaited<ReturnType<typeof findPersonByEmail>> = { profile: null, match: "Missing" };
      if (email) {
        try { result = await findPersonByEmail(config.peopleBaseUrl, email); }
        catch { result = { profile: null, match: "Missing" }; }
      }
      const profile = result.profile;
      const addition = workspaceUserAddition(user);
      const workspaceRole: Member["workspaceRole"] = user.role?.toLowerCase() === "owner" ? "Owner" : user.role?.toLowerCase() === "admin" ? "Admin" : "Member";
      const status: Member["status"] = user.status?.toLowerCase().includes("invite") ? "Invited" : user.status?.toLowerCase().includes("inactive") ? "Inactive" : "Active";
      return {
        id: user.id, name: user.name || profile?.displayName || email || "Unnamed member", email,
        workspaceRole, peopleRole: profile?.title ?? null, department: profile?.department ?? profile?.rootDepartment ?? null,
        manager: profile?.manager?.displayName ?? null, entity: entityFromCompany(profile?.company, email), company: profile?.company ?? null,
        status, peopleMatch: result.match, ...addition,
      };
    });

    const snapshot = {
      members: enriched,
      groups: openAiGroups.map((group) => ({
        id: group.id, name: group.name, description: group.description ?? "",
        source: group.is_scim_managed || /scim/i.test(`${group.source ?? ""} ${group.type ?? ""}`) ? "SCIM" as const : "Manual" as const,
      })),
      memberships: [...groupMembers].flatMap(([groupId, userIds]) => userIds.map((memberId) => ({ memberId, groupId }))),
    };

    const changesCreated = await saveSnapshot(snapshot, runId, startedAt);
    let usageHistory: {
      updated: boolean;
      source: string;
      imported: number;
      unmatched: number;
      fetched: number;
      message: string;
    };
    try {
      const usage = await listDailyCodexUsage(
        config.openAiBaseUrl,
        config.workspaceId,
        adminKey,
        config.analyticsHistoryDays,
      );
      const result = await importUsage(usage.rows, "Codex Analytics API");
      usageHistory = {
        updated: result.imported > 0,
        source: "Codex Analytics API",
        imported: result.imported,
        unmatched: result.unmatched,
        fetched: usage.fetched,
        message: usage.fetched === 0
          ? `Codex Analytics returned no usage from ${usage.startDate} through ${usage.endDate}.`
          : result.imported === 0
            ? `Codex Analytics returned ${usage.fetched} rows, but none matched a current workspace member.`
            : `Loaded ${result.imported} daily usage rows from ${usage.startDate} through ${usage.endDate}${result.unmatched ? `; ${result.unmatched} rows were not matched to a current member` : ""}.`,
      };
    } catch (error) {
      usageHistory = {
        updated: false,
        source: "Codex Analytics API",
        imported: 0,
        unmatched: 0,
        fetched: 0,
        message: codexAnalyticsError(error),
      };
    }
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName);
    if (!dashboard) throw new Error("The sync completed, but no saved dashboard was produced.");
    dashboard.mode = "live";
    const resolvedAttribution = enriched.filter((member) => member.addedByName || member.addedByEmail || member.additionSource === "SCIM").length;
    return Response.json({
      dashboard,
      changesCreated,
      sync: {
        directory: { members: enriched.length, groups: openAiGroups.length },
        usageHistory,
        attribution: {
          resolved: resolvedAttribution,
          unresolved: enriched.length - resolvedAttribution,
          message: "Inviter identity is retained only when the directory response provides it; otherwise an audit source is required.",
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace sync failed.";
    try { await saveFailedSync(runId, startedAt, message); } catch { /* Keep the original error. */ }
    return Response.json({ error: message }, { status: 500 });
  }
}
