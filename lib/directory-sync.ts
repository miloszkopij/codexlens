import { acquireWorkspaceLock, releaseWorkspaceLock, renewWorkspaceLock } from "../db/access-store";
import type { Member } from "../app/types";
import { getDashboard, importUsage, saveFailedSync, saveSnapshot } from "../db/store";
import { codexAnalyticsError, listDailyCodexUsage } from "../lib/codex-analytics";
import { listDailyUnifiedUsage } from "../lib/unified-analytics";
import { getWorkspaceConfig } from "../lib/config";
import { mapWithConcurrency } from "../lib/http";
import { listGroupUsers, listWorkspaceGroups, listWorkspaceUsers, workspaceUserAddition } from "../lib/openai-admin";
import { entityFromCompany, findPersonByEmail } from "../lib/people-api";
import { displayWorkspaceRole } from "../lib/workspace-roles";
import { syncWorkspaceRoles } from "../lib/role-sync";



export async function runDirectorySync(usageMode: "none" | "incremental" | "full" = "full") {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const config = getWorkspaceConfig({ requireAdminKey: true });
  if (!await acquireWorkspaceLock(config.workspaceId, runId)) throw new Error("A sync or membership operation is already running.");
  try {
    const adminKey = config.adminKey as string;
    const [openAiUsers, openAiGroups] = await Promise.all([
      listWorkspaceUsers(config.openAiBaseUrl, config.workspaceId, adminKey),
      listWorkspaceGroups(config.openAiBaseUrl, config.workspaceId, adminKey),
    ]);

    const groupMembers = new Map<string, string[]>();
    for (const group of openAiGroups) {
      await renewWorkspaceLock(config.workspaceId, runId);
      const users = await listGroupUsers(config.openAiBaseUrl, config.workspaceId, group.id, adminKey);
      groupMembers.set(group.id, users.map((user) => user.id));
    }

    const previous = await getDashboard(config.workspaceId, config.workspaceName);
    const previousById = new Map(previous?.members.map((member) => [member.id, member]) ?? []);
    let staleProfiles = 0;
    const enriched = await mapWithConcurrency(openAiUsers, 8, async (user, index) => {
      if (index % 20 === 0) await renewWorkspaceLock(config.workspaceId, runId);
      const email = String(user.email ?? "").trim();
      let result: Awaited<ReturnType<typeof findPersonByEmail>> = { profile: null, match: "Missing" };
      let unavailable = false;
      if (email) {
        try { result = await findPersonByEmail(config.peopleBaseUrl, email); }
        catch { unavailable = true; staleProfiles++; }
      }
      const profile = result.profile;
      const old = previousById.get(user.id);
      const addition = workspaceUserAddition(user);
      const workspaceRole: Member["workspaceRole"] = displayWorkspaceRole(user.role ?? "");
      const status: Member["status"] = user.status?.toLowerCase().includes("invite") ? "Invited" : user.status?.toLowerCase().includes("inactive") ? "Inactive" : "Active";
      return {
        id: user.id, name: user.name || profile?.displayName || email || "Unnamed member", email,
        workspaceRole, peopleRole: unavailable ? old?.peopleRole ?? null : profile?.title ?? null, department: unavailable ? old?.department ?? null : profile?.department ?? profile?.rootDepartment ?? null,
        manager: unavailable ? old?.manager ?? null : profile?.manager?.displayName ?? null, entity: unavailable && old ? old.entity : entityFromCompany(profile?.company, email), company: profile?.company ?? null,
        status, peopleMatch: unavailable ? "Stale" as const : result.match, ...addition,
      };
    });

    const snapshot = {
      members: enriched,
      groups: openAiGroups.map((group) => ({
        id: group.id, name: group.name, description: group.description ?? "",
        source: group.is_scim_managed || /scim|dynamic/i.test(`${group.source ?? ""} ${group.type ?? ""}`) ? "SCIM" as const : "Manual" as const,
      })),
      memberships: [...groupMembers].flatMap(([groupId, userIds]) => userIds.map((memberId) => ({ memberId, groupId }))),
    };

    await renewWorkspaceLock(config.workspaceId, runId);
    const changesCreated = await saveSnapshot(snapshot, runId, startedAt);
    const roleImport = await syncWorkspaceRoles(config, openAiGroups, () => renewWorkspaceLock(config.workspaceId, runId));
    let usageHistory: {
      updated: boolean;
      source: string;
      imported: number;
      unmatched: number;
      fetched: number;
      message: string;
    };
    if (usageMode === "none") {
      usageHistory = { updated: false, source: "Codex Analytics API", imported: 0, unmatched: 0, fetched: 0, message: "Directory-only refresh. Usage is refreshed separately." };
    } else try {
      let usage: Awaited<ReturnType<typeof listDailyUnifiedUsage>>;
      let source = "Unified Usage API";
      let fallbackReason: string | null = null;
      try {
        usage = await listDailyUnifiedUsage(config.openAiBaseUrl, config.workspaceId, adminKey,
          usageMode === "incremental" ? 7 : config.analyticsHistoryDays);
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, "[redacted]") : "Unified Analytics unavailable";
        source = "Codex Analytics API";
        usage = await listDailyCodexUsage(config.openAiBaseUrl, config.workspaceId, adminKey,
          usageMode === "incremental" ? 7 : config.analyticsHistoryDays);
      }
      await renewWorkspaceLock(config.workspaceId, runId);
      const result = await importUsage(usage.rows, source);
      usageHistory = {
        updated: result.imported > 0,
        source,
        imported: result.imported,
        unmatched: result.unmatched,
        fetched: usage.fetched,
        message: usage.fetched === 0
          ? `${source} returned no usage from ${usage.startDate} through ${usage.endDate}.`
          : result.imported === 0
            ? `${source} returned ${usage.fetched} rows, but none could be attributed to a member.`
            : `Loaded ${result.imported} daily usage rows from ${source}, ${usage.startDate} through ${usage.endDate}${result.unmatched ? `; ${result.unmatched} rows were not matched to a current member` : ""}.${usage.fetched > usage.rows.length ? ` ${usage.fetched - usage.rows.length} source rows without usable per-user credit totals were skipped.` : ""}${fallbackReason ? ` Unified feed unavailable (${fallbackReason}); these rows cover Codex only.` : ""}`,
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
    return {
      dashboard,
      changesCreated,
      sync: {
        directory: { members: enriched.length, groups: openAiGroups.length, staleProfiles },
        usageHistory,
        roleImport,
        attribution: {
          resolved: resolvedAttribution,
          unresolved: enriched.length - resolvedAttribution,
          message: "Inviter identity is retained only when the directory response provides it; otherwise an audit source is required.",
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace sync failed.";
    try { await saveFailedSync(runId, startedAt, message); } catch { /* Keep the original error. */ }
    throw new Error(message);
  } finally { await releaseWorkspaceLock(config.workspaceId, runId); }
}
