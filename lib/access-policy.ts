import type { Member, MemberStructureContext, OrganizerMappings, StructureGroupRule, WorkspaceGroup } from "../app/types";

type Group = Pick<WorkspaceGroup, "id" | "name" | "source">;
export const specialGroupNames = ["admin", "cat-team"] as const;
export const emptyAccessRules: OrganizerMappings = { policyVersion: 2, roleToGroups: {}, roleToGroupsInLeaderStructure: {}, roleToGroupsOutsideLeaderStructure: {}, entityToGroups: {}, emailDomainToGroups: {}, structureRules: [], memberOverrides: {} };
/** Stable revision for draft saves; map insertion order is not a policy change. */
export function accessRulesRevision(rules: OrganizerMappings) {
  const map = (entries: Record<string, string[] | undefined>) => Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => [key, [...(ids ?? [])].sort()]);
  return JSON.stringify({ version: rules.policyVersion ?? null, overrides: Object.entries(rules.memberOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b)), domains: map(rules.emailDomainToGroups), titles: map(rules.roleToGroups), insideTitles: map(rules.roleToGroupsInLeaderStructure ?? {}), outsideTitles: map(rules.roleToGroupsOutsideLeaderStructure ?? {}), entities: map(rules.entityToGroups),
    structures: [...(rules.structureRules ?? [])].sort((a, b) => a.managerId.localeCompare(b.managerId)).map((rule) => [rule.managerId, rule.managerName, rule.managerEmail, rule.groupId]) });
}
export function isSpecialGroup(group: Pick<Group, "name">) {
  return specialGroupNames.some((name) => name === group.name.trim().toLowerCase());
}
export function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  if (domain.length > 253 || !domain.includes(".") || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("Enter an exact email domain, for example ceneo.pl. Wildcards and email addresses are not domains.");
  }
  return domain;
}
export function emailDomain(email: string) {
  const parts = email.trim().split("@");
  if (parts.length !== 2 || !parts[0] || /\s/.test(parts[0])) return "";
  try { return normalizeDomain(parts[1]); } catch { return ""; }
}
export function titleMatchesWords(title: string, query: string) {
  const normalize = (value: string) => value.normalize("NFKD").replace(/[łŁ]/g, (letter) => letter === "Ł" ? "L" : "l").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const haystack = normalize(title);
  return normalize(query).trim().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}
export function memberGroupIds(member: Pick<Member, "groupIds" | "groups">, groups: Group[]) {
  if (member.groupIds) {
    const ids = [...new Set(member.groupIds)].sort();
    if (ids.some((id) => !groups.some((group) => group.id === id))) throw new Error("Unresolved membership. Sync before editing.");
    return ids;
  }
  return [...new Set(member.groups.map((name) => {
    const matches = groups.filter((group) => group.name === name);
    if (matches.length !== 1) throw new Error("Ambiguous group name. Sync before editing.");
    return matches[0].id;
  }))].sort();
}
/** Unresolved memberships are unknown, not safely classifiable as unassigned. */
export function hasNoRegularGroup(member: Pick<Member, "groupIds" | "groups">, groups: Group[]) {
  try { return memberGroupIds(member, groups).every((id) => isSpecialGroup(groups.find((group) => group.id === id)!)); }
  catch { return false; }
}
export type LeaderScope = "inside" | "outside";
export function leaderScope(structure?: MemberStructureContext): LeaderScope | null {
  if (!structure || structure.problem || !structure.personId || !structure.leaderId) return null;
  return structure.personId === structure.leaderId || structure.ancestorIds.includes(structure.leaderId) ? "inside" : "outside";
}
export function scopedRoleGroups(rules: OrganizerMappings, title: string, scope: LeaderScope): string[] {
  const map = scope === "inside" ? rules.roleToGroupsInLeaderStructure : rules.roleToGroupsOutsideLeaderStructure;
  return map && Object.hasOwn(map, title) ? map[title] : rules.roleToGroups[title] ?? [];
}
export function reviewMember(member: Member, groups: Group[], rules: OrganizerMappings, structure?: MemberStructureContext) {
  let current: string[] = []; let problem = "";
  try { current = memberGroupIds(member, groups); } catch (error) { problem = (error as Error).message; }
  const special = current.filter((id) => isSpecialGroup(groups.find((group) => group.id === id)!));
  const regular = current.filter((id) => !special.includes(id));
  const overrideId = rules.memberOverrides?.[member.id];
  if (overrideId) {
    const target = groups.find((group) => group.id === overrideId);
    if (!target || target.source !== "Manual") problem ||= "Person exception target is unavailable or externally managed.";
    if (rules.policyVersion !== 2) problem ||= "Review and save the migrated rules in Organize first.";
    if (member.status !== "Active") problem ||= "Only active members can be assigned by organizer rules.";
    const specialTarget = Boolean(target && isSpecialGroup(target));
    const differs = specialTarget ? !special.includes(overrideId) : regular.length !== 1 || regular[0] !== overrideId;
    if (!specialTarget && differs && regular.some((id) => id !== overrideId && groups.find((group) => group.id === id)?.source !== "Manual")) problem ||= "An existing regular group is externally managed. Change it at its authoritative source.";
    return { current, special, regular, expected: problem ? null : overrideId, source: "person-exception", reason: `Person exception: ${target?.name ?? "unavailable group"}; automatic rules skipped${specialTarget ? "; regular groups stay unchanged" : ""}`, problem,
      status: problem ? "blocked" : differs ? "different" : "aligned", conflict: regular.length > 1, specialTarget };
  }
  const domain = emailDomain(member.email);
  const domainRule = domain ? rules.emailDomainToGroups[domain] : undefined;
  const structureRules = rules.structureRules ?? [];
  // The member's own rule wins over ancestor rules; then walk nearest-first.
  const structureRule = structure && !structure.problem ? [structure.personId, ...structure.ancestorIds].map((id) => structureRules.find((rule) => rule.managerId === id)).find(Boolean) : undefined;
  if (!domainRule?.length && structureRules.length && (!structure || structure.problem)) problem ||= structure?.problem || "Load the People API reporting structure before applying structure or fallback job-title rules.";
  const title = member.peopleRole ?? "";
  const hasScopedRule = Object.hasOwn(rules.roleToGroupsInLeaderStructure ?? {}, title) || Object.hasOwn(rules.roleToGroupsOutsideLeaderStructure ?? {}, title);
  const scope = leaderScope(structure);
  if (!domainRule?.length && !structureRule && hasScopedRule && !scope) problem ||= structure?.problem || "Verify David Roberts’s reporting structure in People API before applying this scoped job-title rule.";
  const source = domainRule?.length ? "domain" : structureRule ? "structure" : "job-title";
  const candidates = domainRule?.length ? domainRule : structureRule ? [structureRule.groupId] : member.peopleMatch === "Matched" ? scope ? scopedRoleGroups(rules, title, scope) : hasScopedRule ? [] : rules.roleToGroups[title] ?? [] : [];
  let reason = domainRule?.length ? `Email domain @${domain} overrides structure and job-title rules` : structureRule ? `Reporting structure of ${structureRule.managerName} (${structureRule.managerId === structure?.personId ? "selected manager included" : "nearest configured manager"}); overrides job-title rules` : `People API job title: ${member.peopleRole || "missing"}${scope ? ` · ${scope === "inside" ? "inside" : "outside"} David Roberts’s structure` : ""}`;
  if (rules.policyVersion !== 2) problem ||= "Review and save the migrated rules in Organize first.";
  if (!domainRule?.length && !structureRule && member.peopleMatch !== "Matched") problem ||= `People API profile is ${member.peopleMatch.toLowerCase()}; job-title rules are blocked.`;
  if (candidates.length > 1) problem ||= "This legacy rule has multiple targets. Choose one regular group.";
  const target = candidates.length === 1 ? groups.find((group) => group.id === candidates[0]) : undefined;
  if (candidates.length === 1 && (!target || isSpecialGroup(target) || target.source !== "Manual")) problem ||= "Rule target is unavailable, special, or externally managed.";
  if (!candidates.length && !problem) reason = "No matching email-domain, structure, or job-title rule. Choose a group manually or add a rule.";
  if (member.status !== "Active") problem ||= "Only active members can be assigned by organizer rules.";
  const expected = !problem && target ? target.id : null;
  const differs = Boolean(expected && (regular.length !== 1 || regular[0] !== expected));
  if (differs && regular.some((id) => id !== expected && groups.find((group) => group.id === id)?.source !== "Manual")) problem ||= "An existing regular group is externally managed. Change it at its authoritative source.";
  const status = problem ? "blocked" : !expected ? "unmapped" : differs ? "different" : "aligned";
  return { current, special, regular, expected, source, reason, problem, status, conflict: regular.length > 1, specialTarget: false };
}

export const memberGroupStatusLabels = {
  conflict: "Conflict",
  missing: "Needs regular group",
  single: "One regular group",
} as const;
/** Same primary status for the members table and its filter; special groups do not count. */
export function memberGroupStatus(review: Pick<ReturnType<typeof reviewMember>, "conflict" | "regular">): keyof typeof memberGroupStatusLabels {
  return review.conflict ? "conflict" : !review.regular.length ? "missing" : "single";
}

export interface AccessChange {
  memberId: string; name: string; email: string; before: string[]; after: string[];
  remove: string[]; add: string[]; retainedSpecial: string[]; reason: string;
}
export type AccessOperation = { kind: "rules" } | { kind: "move"; groupId: string } | { kind: "special"; groupId: string; action: "add" | "remove" };

export function planMemberChange(member: Member, groups: Group[], rules: OrganizerMappings, operation: AccessOperation, structure?: MemberStructureContext): AccessChange | null {
  const before = memberGroupIds(member, groups);
  const special = before.filter((id) => isSpecialGroup(groups.find((group) => group.id === id)!));
  let after = [...before]; let reason = "Manual membership change";
  if (operation.kind === "special") {
    const group = groups.find((item) => item.id === operation.groupId);
    if (!group || !isSpecialGroup(group) || group.source !== "Manual") throw new Error("Choose a manually managed special group.");
    if (!["add", "remove"].includes(operation.action)) throw new Error("Choose add or remove.");
    if (operation.action === "add" && member.status !== "Active") throw new Error("Only active members can receive a special-group assignment.");
    after = operation.action === "add" ? [...new Set([...before, group.id])] : before.filter((id) => id !== group.id);
    reason = `Explicit manual ${operation.action}: special group ${group.name}. Regular groups remain unchanged.`;
  } else {
    const review = reviewMember(member, groups, rules, structure);
    const id = operation.kind === "move" ? operation.groupId : review.expected;
    if (operation.kind === "rules" && (review.problem || !id)) throw new Error(review.problem || review.reason);
    const target = groups.find((group) => group.id === id);
    if (!target || target.source !== "Manual" || (isSpecialGroup(target) && (operation.kind !== "rules" || !review.specialTarget))) throw new Error("Choose one manually managed regular group.");
    if (member.status !== "Active") throw new Error("Only active members can be moved.");
    after = operation.kind === "rules" && review.specialTarget ? [...new Set([...before, target.id])] : [...special, target.id];
    reason = operation.kind === "rules" ? review.reason : `Manual move to ${target.name}; special memberships retained`;
  }
  after.sort();
  const remove = before.filter((id) => !after.includes(id));
  const add = after.filter((id) => !before.includes(id));
  if (remove.some((id) => groups.find((group) => group.id === id)?.source !== "Manual")) throw new Error("Externally managed memberships cannot be removed here.");
  if (!remove.length && !add.length) return null;
  return { memberId: member.id, name: member.name, email: member.email, before, after, remove, add,
    retainedSpecial: special.filter((id) => after.includes(id)), reason };
}

export function validateAccessRules(input: OrganizerMappings, groups: Group[]): OrganizerMappings {
  if (input.policyVersion !== 2) throw new Error("Review and save version 2 assignment rules.");
  if (Object.keys(input.entityToGroups ?? {}).length) throw new Error("Entity rules are retired. Use email-domain rules instead.");
  function validateMap(map: Record<string, string[]>, domains: boolean, preserveEmpty = false) {
    if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 1000) throw new Error("Provide up to 1,000 mapping rows.");
    const result: Record<string, string[]> = Object.create(null);
    for (const [key, value] of Object.entries(map)) {
      if (!Array.isArray(value) || value.length > 1 || (value.length === 1 && typeof value[0] !== "string")) throw new Error("Every enabled rule must have exactly one destination.");
      const normalized = domains ? normalizeDomain(key) : key.trim();
      if (!normalized || normalized.length > 253 || Object.hasOwn(result, normalized)) throw new Error("Duplicate or invalid rule key.");
      if (value.length === 0) { if (preserveEmpty) result[normalized] = []; continue; } // A scoped empty row explicitly disables a legacy fallback.
      const group = groups.find((item) => item.id === value[0]);
      if (!group || group.source !== "Manual" || isSpecialGroup(group)) throw new Error("Rules may target only regular, manually managed groups. Special groups are assigned to individual members.");
      result[normalized] = [group.id];
    }
    return result;
  }
  const rawStructures = input.structureRules === undefined ? [] : input.structureRules;
  if (!Array.isArray(rawStructures) || rawStructures.length > 100) throw new Error("Provide up to 100 structure rules.");
  const managers = new Set<string>();
  const structureRules: StructureGroupRule[] = rawStructures.map((rule) => {
    if (!rule || typeof rule.managerId !== "string" || !rule.managerId.trim() || rule.managerId.length > 200 || typeof rule.managerName !== "string" || !rule.managerName.trim() || rule.managerName.length > 200 || (rule.managerEmail !== null && (typeof rule.managerEmail !== "string" || rule.managerEmail.length > 254))) throw new Error("Select a specific manager from People API search results.");
    const managerId = rule.managerId.trim();
    if (managers.has(managerId)) throw new Error("Each manager can have only one structure rule.");
    managers.add(managerId);
    const target = groups.find((group) => group.id === rule.groupId);
    if (!target || target.source !== "Manual" || isSpecialGroup(target)) throw new Error("Structure rules must select one regular, manually managed group.");
    return { managerId, managerName: rule.managerName.trim(), managerEmail: rule.managerEmail?.trim() || null, groupId: target.id };
  });
  const rawOverrides = input.memberOverrides ?? {};
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides) || Object.keys(rawOverrides).length > 1000) throw new Error("Provide up to 1,000 person exceptions.");
  const memberOverrides: Record<string, string> = Object.create(null);
  for (const [memberId, groupId] of Object.entries(rawOverrides)) {
    if (!memberId.trim() || memberId.length > 200 || typeof groupId !== "string") throw new Error("Choose a specific workspace member for each exception.");
    const target = groups.find((group) => group.id === groupId);
    if (!target || target.source !== "Manual") throw new Error("Person exceptions may target only manually managed groups.");
    memberOverrides[memberId] = target.id;
  }
  return { policyVersion: 2, roleToGroups: validateMap(input.roleToGroups, false),
    roleToGroupsInLeaderStructure: validateMap(input.roleToGroupsInLeaderStructure ?? {}, false, true),
    roleToGroupsOutsideLeaderStructure: validateMap(input.roleToGroupsOutsideLeaderStructure ?? {}, false, true),
    emailDomainToGroups: validateMap(input.emailDomainToGroups, true), entityToGroups: {}, structureRules, memberOverrides };
}

export function reviewFingerprint(members: Member[], groups: Group[], rules: OrganizerMappings, structures?: Record<string, MemberStructureContext>) {
  return JSON.stringify({ members: [...members].sort((a, b) => a.id.localeCompare(b.id)).map((m) => ({ id: m.id, email: m.email, role: m.peopleRole, match: m.peopleMatch, status: m.status, groups: memberGroupIds(m, groups),
    structure: !rules.memberOverrides?.[m.id] && (rules.structureRules?.length || Object.hasOwn(rules.roleToGroupsInLeaderStructure ?? {}, m.peopleRole ?? "") || Object.hasOwn(rules.roleToGroupsOutsideLeaderStructure ?? {}, m.peopleRole ?? "")) && !rules.emailDomainToGroups[emailDomain(m.email)]?.length ? structures?.[m.id] ?? null : undefined })),
    groups: [...groups].sort((a, b) => a.id.localeCompare(b.id)).map((g) => [g.id, g.name, g.source]), rules });
}
