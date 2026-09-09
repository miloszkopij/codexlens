import type { ManagementCostData, ManagementCostRow, Member } from "../../types";
import { getAnalytics, getDashboard } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";
import { mapWithConcurrency } from "../../../lib/http";
import { findPersonByDisplayName, listEmployees, type PeopleProfile } from "../../../lib/people-api";

export const dynamic = "force-dynamic";

const profileCache = new Map<string, { expiresAt: number; profile: PeopleProfile | null }>();
const PROFILE_CACHE_MS = 60 * 60 * 1000;

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
  const key = normalizedName(name);
  const cached = profileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  try {
    const result = await findPersonByDisplayName(baseUrl, name);
    const profile = result.match === "Matched" ? result.profile : null;
    profileCache.set(key, { expiresAt: Date.now() + PROFILE_CACHE_MS, profile });
    return profile;
  } catch {
    profileCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, profile: null });
    return null;
  }
}

function profileIdentity(profile: PeopleProfile, fallback: string) {
  return {
    id: String(profile.id ?? profile.personNumber ?? normalizedName(profile.displayName) ?? fallback),
    name: profile.displayName || fallback,
    email: profile.email || null,
    title: profile.title || null,
    department: profile.department || profile.rootDepartment || null,
  };
}

function estimatedInvoice(settings: Awaited<ReturnType<typeof getAnalytics>>["settings"]) {
  if (settings.unbilledOverageCredits === null || settings.pricePerCredit === null) return null;
  return settings.unbilledOverageCredits * settings.pricePerCredit;
}

export async function GET(request: Request) {
  try {
    const config = getWorkspaceConfig();
    const url = new URL(request.url);
    const fallbackEnd = todayIso();
    const startDate = validDate(url.searchParams.get("start")) ?? daysBefore(fallbackEnd, 29);
    const endDate = validDate(url.searchParams.get("end")) ?? fallbackEnd;
    if (startDate > endDate) return Response.json({ error: "Start date must not be after end date." }, { status: 400 });

    const [dashboard, analytics, leaderResult] = await Promise.all([
      getDashboard(config.workspaceId, config.workspaceName),
      getAnalytics({ startDate, endDate, bucket: "day" }),
      findPersonByDisplayName(config.peopleBaseUrl, config.managementLeaderName),
    ]);
    if (!dashboard) throw new Error("Sync the workspace directory before opening management costs.");
    if (!leaderResult.profile || leaderResult.match !== "Matched") {
      throw new Error(`${config.managementLeaderName} could not be matched uniquely in People API.`);
    }
    const leader = leaderResult.profile;
    if (!leader.id) throw new Error(`${config.managementLeaderName}'s People API profile has no stable id.`);

    const employeeProfiles = await listEmployees(config.peopleBaseUrl, leader.id);
    const leaderKey = normalizedName(leader.displayName || config.managementLeaderName);
    const directProfiles = employeeProfiles.filter((profile) => normalizedName(profile.manager?.displayName) === leaderKey);
    if (!directProfiles.length) throw new Error(`People API returned no direct reports for ${leader.displayName || config.managementLeaderName}.`);

    const directByName = new Map(directProfiles.map((profile) => [normalizedName(profile.displayName), profile]));
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
        const direct = directByName.get(key);
        if (direct) return direct;
        const manager = depth === 0 && member.manager
          ? member.manager
          : localManagerByName.get(key) ?? await remoteManager(cursor);
        if (!manager || normalizedName(manager) === leaderKey) return null;
        cursor = manager;
      }
      return null;
    }

    const ownerProfiles = await mapWithConcurrency(dashboard.members, 14, directOwner);
    const ownerByMemberId = new Map<string, PeopleProfile>();
    ownerProfiles.forEach((profile, index) => { if (profile) ownerByMemberId.set(dashboard.members[index].id, profile); });
    const usageByMember = new Map(analytics.byUser.map((row) => [row.id, row]));
    const rootRows = new Map<string, ManagementCostRow>();
    for (const profile of directProfiles) {
      const identity = profileIdentity(profile, "Direct manager");
      rootRows.set(normalizedName(identity.name), {
        ...identity, memberCount: 0, activeUsers: 0, messages: 0, usage: 0, usageValue: analytics.valuationCoverage === "complete" ? 0 : null,
        davidOrgShare: 0, invoiceShare: 0, allocatedInvoiceCost: null, reconciliation: false,
      });
    }

    let mappedMembers = 0;
    for (const member of dashboard.members) {
      const owner = ownerByMemberId.get(member.id);
      if (!owner) continue;
      const row = rootRows.get(normalizedName(owner.displayName));
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
    const davidOrgUsage = [...rootRows.values()].reduce((sum, row) => sum + row.usage, 0);
    const rawInvoice = estimatedInvoice(analytics.settings);
    const invoiceSnapshotMatches = rawInvoice !== null && analytics.unit === "credits" &&
      analytics.settings.billingPeriodStart === startDate && Boolean(analytics.settings.billingPeriodEnd) &&
      endDate <= (analytics.settings.billingPeriodEnd as string);
    const invoice = invoiceSnapshotMatches ? rawInvoice : null;

    for (const row of rootRows.values()) {
      row.davidOrgShare = davidOrgUsage > 0 ? row.usage / davidOrgUsage : 0;
      row.invoiceShare = workspaceUsage > 0 ? row.usage / workspaceUsage : 0;
      row.allocatedInvoiceCost = invoice === null ? null : invoice * row.invoiceShare;
    }

    const unresolvedMembers = dashboard.members.length - mappedMembers;
    const outsideUsage = Math.max(0, workspaceUsage - davidOrgUsage);
    const outsideValue = analytics.totals.usageValue === null
      ? null
      : Math.max(0, analytics.totals.usageValue - [...rootRows.values()].reduce((sum, row) => sum + (row.usageValue ?? 0), 0));
    const outsideRow: ManagementCostRow = {
      id: "__outside_david_org__", name: `Outside ${leader.displayName || config.managementLeaderName}'s org / unresolved`, email: null,
      title: "Workspace reconciliation", department: null, memberCount: unresolvedMembers,
      activeUsers: Math.max(0, analytics.totals.activeUsers - [...rootRows.values()].reduce((sum, row) => sum + row.activeUsers, 0)),
      messages: Math.max(0, analytics.totals.messages - [...rootRows.values()].reduce((sum, row) => sum + row.messages, 0)),
      usage: outsideUsage, usageValue: outsideValue, davidOrgShare: 0,
      invoiceShare: workspaceUsage > 0 ? outsideUsage / workspaceUsage : 0,
      allocatedInvoiceCost: invoice === null ? null : invoice * (workspaceUsage > 0 ? outsideUsage / workspaceUsage : 0),
      reconciliation: true,
    };
    const rows = [...rootRows.values()].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
    rows.push(outsideRow);

    const warningParts = [];
    if (!invoiceSnapshotMatches) warningParts.push(`Invoice allocation is unavailable because the saved OpenAI Billing snapshot does not cover ${startDate} – ${endDate}. Update Billing & settings; usage fractions remain valid.`);
    if (unresolvedMembers > 0) warningParts.push(`${unresolvedMembers} current members are outside David's reporting tree or could not be resolved through People API; they are retained in the reconciliation row.`);
    if (analytics.warning) warningParts.push(analytics.warning);

    const response: ManagementCostData = {
      leader: profileIdentity(leader, config.managementLeaderName),
      startDate, endDate, billingPeriodEnd: analytics.settings.billingPeriodEnd,
      unit: analytics.unit, source: analytics.source, currency: analytics.settings.currency,
      workspaceUsage, workspaceUsageValue: analytics.totals.usageValue,
      estimatedInvoice: invoice,
      invoiceSnapshotPeriod: analytics.settings.billingPeriodStart && analytics.settings.billingPeriodEnd
        ? `${analytics.settings.billingPeriodStart} – ${analytics.settings.billingPeriodEnd}` : null,
      invoiceAllocationAvailable: invoice !== null,
      davidOrgUsage,
      davidOrgInvoiceShare: workspaceUsage > 0 ? davidOrgUsage / workspaceUsage : 0,
      davidOrgAllocatedCost: invoice === null ? null : invoice * (workspaceUsage > 0 ? davidOrgUsage / workspaceUsage : 0),
      mappedMembers, unresolvedMembers, rows,
      warning: warningParts.join(" ") || null,
    };
    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load management costs." }, { status: 500 });
  }
}
