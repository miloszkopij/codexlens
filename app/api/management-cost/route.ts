import type { ManagementCostData, ManagementCostRow, Member } from "../../types";
import { getAnalytics, getDashboard } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";
import { mapWithConcurrency } from "../../../lib/http";
import { findPersonByDisplayName, findPersonById, listEmployees, profileId, type PeopleProfile } from "../../../lib/people-api";

export const dynamic = "force-dynamic";

const profileCache = new Map<string, { expiresAt: number; profile: PeopleProfile | null }>();
const PROFILE_CACHE_MS = 60 * 60 * 1000;
const PROFILE_CACHE_MAX_ENTRIES = 512;

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? value : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBefore(endDate: string, days: number) {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizedName(value?: string | null) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function cachedProfile(baseUrl: string, name: string) {
  const key = `${baseUrl.replace(/\/+$/, "")}|${normalizedName(name)}`;
  const cached = profileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  const save = (profile: PeopleProfile | null, ttl: number) => {
    profileCache.set(key, { expiresAt: Date.now() + ttl, profile });
    while (profileCache.size > PROFILE_CACHE_MAX_ENTRIES) {
      const oldestKey = profileCache.keys().next().value;
      if (!oldestKey) break;
      profileCache.delete(oldestKey);
    }
  };
  try {
    const result = await findPersonByDisplayName(baseUrl, name);
    const profile = result.match === "Matched" ? result.profile : null;
    save(profile, PROFILE_CACHE_MS);
    return profile;
  } catch {
    save(null, 5 * 60 * 1000);
    return null;
  }
}

function profileIdentity(profile: PeopleProfile, fallback: string) {
  return {
    id: profileId(profile) ?? (normalizedName(profile.displayName) || fallback),
    name: profile.displayName || fallback,
    email: profile.email || null,
    title: profile.title || null,
    department: profile.department || profile.rootDepartment || null,
  };
}

export async function GET(request: Request) {
  try {
    const config = getWorkspaceConfig();
    const url = new URL(request.url);
    const managerId = url.searchParams.get("managerId")?.trim() || null;
    if (managerId && managerId.length > 200) return Response.json({ error: "Manager ID is invalid." }, { status: 400 });
    const fallbackEnd = todayIso();
    const startDate = validDate(url.searchParams.get("start")) ?? daysBefore(fallbackEnd, 29);
    const endDate = validDate(url.searchParams.get("end")) ?? fallbackEnd;
    if (startDate > endDate) return Response.json({ error: "Start date must not be after end date." }, { status: 400 });

    const [dashboard, analytics] = await Promise.all([
      getDashboard(config.workspaceId, config.workspaceName),
      getAnalytics({ startDate, endDate, bucket: "day" }),
    ]);
    if (!dashboard) throw new Error("Sync the workspace directory before opening management costs.");
    let leader: PeopleProfile | null;
    let leaderLabel: string;
    if (managerId) {
      leader = await findPersonById(config.peopleBaseUrl, managerId);
      leaderLabel = leader?.displayName || managerId;
      if (!leader) return Response.json({ error: `The selected manager (${managerId}) could not be found in People API.` }, { status: 404 });
    } else {
      const result = await findPersonByDisplayName(config.peopleBaseUrl, config.managementLeaderName);
      leader = result.match === "Matched" ? result.profile : null;
      leaderLabel = config.managementLeaderName;
      if (!leader) throw new Error(`${config.managementLeaderName} could not be matched uniquely in People API.`);
    }
    const leaderId = profileId(leader);
    if (!leaderId) throw new Error(`${leaderLabel}’s People API profile has no stable id.`);

    const employeeProfiles = await listEmployees(config.peopleBaseUrl, leaderId);
    const leaderKey = normalizedName(leader.displayName || leaderLabel);
    const directProfiles = employeeProfiles.filter((profile) => {
      const managerIdFromProfile = profileId(profile.manager);
      return (managerIdFromProfile && managerIdFromProfile === leaderId) || normalizedName(profile.manager?.displayName) === leaderKey;
    });

    const directByName = new Map<string, PeopleProfile | null>();
    for (const profile of directProfiles) {
      const key = normalizedName(profile.displayName);
      if (!key) continue;
      directByName.set(key, directByName.has(key) ? null : profile);
    }
    const directByEmail = new Map(directProfiles.filter((profile) => profile.email).map((profile) => [profile.email!.toLowerCase(), profile]));
    const localManagerByName = new Map(
      dashboard.members.filter((member) => member.manager).map((member) => [normalizedName(member.name), member.manager as string]),
    );
    const managerPromiseCache = new Map<string, Promise<string | null>>();

    function remoteManager(name: string) {
      const key = normalizedName(name);
      const cached = managerPromiseCache.get(key);
      if (cached) return cached;
      const pending = cachedProfile(config.peopleBaseUrl, name).then((profile) => profile?.manager?.displayName || null);
      managerPromiseCache.set(key, pending);
      return pending;
    }

    async function directOwner(member: Member) {
      let cursor = member.name;
      const visited = new Set<string>();
      for (let depth = 0; depth < 18; depth += 1) {
        const key = normalizedName(cursor);
        if (!key || visited.has(key)) return null;
        visited.add(key);
        const direct = directByEmail.get(member.email.toLowerCase()) ?? directByName.get(key) ?? null;
        if (direct) return direct;
        const manager = depth === 0 && member.manager
          ? member.manager
          : localManagerByName.get(key) ?? await remoteManager(cursor);
        if (!manager || normalizedName(manager) === leaderKey) return null;
        cursor = manager;
      }
      return null;
    }

    const leaderMemberIds = new Set(dashboard.members.filter((member) =>
      normalizedName(member.name) === leaderKey || (leader.email && member.email.toLowerCase() === leader.email.toLowerCase()),
    ).map((member) => member.id));
    const ownerProfiles = await mapWithConcurrency(dashboard.members, 14, async (member) => leaderMemberIds.has(member.id) ? null : directOwner(member));
    const ownerByMemberId = new Map<string, PeopleProfile>();
    ownerProfiles.forEach((profile, index) => { if (profile) ownerByMemberId.set(dashboard.members[index].id, profile); });
    const usageByMember = new Map(analytics.byUser.map((row) => [row.id, row]));
    const rootRows = new Map<string, ManagementCostRow>();
    for (const profile of directProfiles) {
      const identity = profileIdentity(profile, "Direct manager");
      rootRows.set(identity.id, {
        ...identity, memberCount: 0, activeUsers: 0, messages: 0, usage: 0, usageValue: analytics.valuationCoverage === "complete" ? 0 : null,
        selectedOrgShare: 0, invoiceShare: 0, allocatedInvoiceCost: null, reconciliation: false,
      });
    }

    let mappedMembers = 0;
    for (const member of dashboard.members) {
      const owner = ownerByMemberId.get(member.id);
      if (!owner) continue;
      const row = rootRows.get(profileId(owner) ?? normalizedName(owner.displayName));
      if (!row) continue;
      mappedMembers += 1;
      row.memberCount += 1;
      const usage = usageByMember.get(member.id);
      if (!usage) continue;
      row.usage += usage.usage;
      row.messages += usage.messages;
      if (usage.usage > 0) row.activeUsers += 1;
      if (row.usageValue !== null) {
        if (usage.usageValue === null) row.usageValue = null;
        else row.usageValue += usage.usageValue;
      }
    }

    const workspaceUsage = analytics.totals.usage;
    const selectedOrgUsage = [...rootRows.values()].reduce((sum, row) => sum + row.usage, 0);
    for (const row of rootRows.values()) {
      row.selectedOrgShare = selectedOrgUsage > 0 ? row.usage / selectedOrgUsage : 0;
      row.invoiceShare = workspaceUsage > 0 ? row.usage / workspaceUsage : 0;
      row.allocatedInvoiceCost = row.usageValue;
    }

    const unresolvedMembers = dashboard.members.length - mappedMembers;
    const outsideUsage = Math.max(0, workspaceUsage - selectedOrgUsage);
    const outsideValue = analytics.totals.usageValue === null
      ? null
      : Math.max(0, analytics.totals.usageValue - [...rootRows.values()].reduce((sum, row) => sum + (row.usageValue ?? 0), 0));
    const outsideRow: ManagementCostRow = {
      id: "__outside_selected_teams__", name: `Outside ${leader.displayName || leaderLabel}'s teams / unresolved`, email: null,
      title: "Workspace reconciliation", department: null, memberCount: unresolvedMembers,
      activeUsers: Math.max(0, analytics.totals.activeUsers - [...rootRows.values()].reduce((sum, row) => sum + row.activeUsers, 0)),
      messages: Math.max(0, analytics.totals.messages - [...rootRows.values()].reduce((sum, row) => sum + row.messages, 0)),
      usage: outsideUsage, usageValue: outsideValue, selectedOrgShare: 0,
      invoiceShare: workspaceUsage > 0 ? outsideUsage / workspaceUsage : 0,
      allocatedInvoiceCost: outsideValue,
      reconciliation: true,
    };
    const rows = [...rootRows.values()].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
    rows.push(outsideRow);

    const warningParts = [];
    if (!directProfiles.length) warningParts.push(`People API returned no direct reports for ${leader.displayName || leaderLabel}. The reconciliation row includes the full workspace until a reporting structure is available.`);
    warningParts.push("Team USD values are attributed usage values, not invoice charges. Shares are fractions of workspace usage. Billing overage is not allocated to people or teams.");
    if (unresolvedMembers > 0) warningParts.push(`${unresolvedMembers} current members are outside ${leader.displayName || leaderLabel}'s reporting tree or could not be resolved through People API; they are retained in the reconciliation row.`);
    if (analytics.warning) warningParts.push(analytics.warning);

    const response: ManagementCostData = {
      leader: profileIdentity(leader, leaderLabel),
      startDate, endDate, billingPeriodEnd: analytics.settings.billingPeriodEnd,
      unit: analytics.unit, source: analytics.source, currency: analytics.settings.currency,
      workspaceUsage, workspaceUsageValue: analytics.totals.usageValue,
      estimatedInvoice: null,
      invoiceSnapshotPeriod: analytics.settings.billingPeriodStart && analytics.settings.billingPeriodEnd
        ? `${analytics.settings.billingPeriodStart} – ${analytics.settings.billingPeriodEnd}` : null,
      invoiceAllocationAvailable: false,
      selectedOrgUsage,
      selectedOrgInvoiceShare: workspaceUsage > 0 ? selectedOrgUsage / workspaceUsage : 0,
      selectedOrgAllocatedCost: analytics.totals.usageValue === null ? null : [...rootRows.values()].reduce((sum, row) => sum + (row.usageValue ?? 0), 0),
      mappedMembers, unresolvedMembers, rows,
      warning: warningParts.join(" ") || null,
    };
    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load management costs." }, { status: 500 });
  }
}
