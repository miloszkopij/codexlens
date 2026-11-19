import type { ExclusiveGroupSet, Member, OrganizerMappings, WorkspaceGroup } from "../app/types";

export type AccessStatus = "all" | "missing" | "extra" | "matches" | "unmapped" | "unresolved" | "conflict";
export type MembershipAction = "add" | "remove";

export function currentGroupIds(member: Member, groups: WorkspaceGroup[]): string[] {
  if (member.groupIds) return [...new Set(member.groupIds)].sort();
  // Legacy/demo snapshots have names only. Never guess between duplicate names.
  return [...new Set(member.groups.flatMap((name) => {
    const matches = groups.filter((group) => group.name === name);
    return matches.length === 1 ? [matches[0].id] : [];
  }))].sort();
}

export function reviewAccess(member: Member, groups: WorkspaceGroup[], mappings: OrganizerMappings, exclusiveSets: ExclusiveGroupSet[]) {
  const current = currentGroupIds(member, groups);
  const known = new Set(groups.map((group) => group.id));
  const resolved = current.every((id) => known.has(id)) && (Boolean(member.groupIds) || current.length === new Set(member.groups).size);
  const expected = new Map<string, string[]>();
  if (member.peopleMatch === "Matched") {
    const domain = member.email.trim().toLowerCase().split("@").pop() ?? "";
    const rules: [string[], string][] = [
      [mappings.roleToGroups[member.peopleRole ?? ""] ?? [], `Job title: ${member.peopleRole}`],
      [mappings.entityToGroups[member.entity] ?? [], `Entity: ${member.entity}`],
      [mappings.emailDomainToGroups[domain] ?? [], `Email domain: ${domain}`],
    ];
    for (const [ids, reason] of rules) for (const id of ids) {
      if (groups.find((group) => group.id === id)?.source !== "Manual") continue;
      expected.set(id, [...(expected.get(id) ?? []), reason]);
    }
  }
  const comparable = resolved && member.peopleMatch === "Matched" && expected.size > 0;
  const missing = comparable ? [...expected.keys()].filter((id) => !current.includes(id)) : [];
  // Saved mappings are additive, not an authoritative allowlist. These are review hints only.
  const extra = comparable ? current.filter((id) => !expected.has(id) && groups.find((group) => group.id === id)?.source === "Manual") : [];
  const conflicts = exclusiveSets.filter((set) => set.groupIds.filter((id) => current.includes(id)).length > 1);
  return { current, count: resolved ? current.length : member.groups.length, resolved, expected, comparable, missing, extra, conflicts,
    matches: comparable && !missing.length && !extra.length,
    unmapped: member.peopleMatch === "Matched" && !expected.size,
    unresolved: member.peopleMatch !== "Matched" || !resolved };
}

export function matchesAccessFilter(review: ReturnType<typeof reviewAccess>, filter: {
  count: string; groupIds: string[]; match: "any" | "all"; status: AccessStatus;
}) {
  const countMatches = filter.count === "all" || (filter.count === "none" && review.count === 0) || (filter.count === "one" && review.count === 1) || (filter.count === "multiple" && review.count > 1);
  const groupsMatch = !filter.groupIds.length || (filter.match === "all" ? filter.groupIds.every((id) => review.current.includes(id)) : filter.groupIds.some((id) => review.current.includes(id)));
  const statusMatches = filter.status === "all" || (filter.status === "missing" && review.missing.length > 0) || (filter.status === "extra" && review.extra.length > 0) || (filter.status === "conflict" && review.conflicts.length > 0) || (filter.status === "matches" && review.matches) || (filter.status === "unmapped" && review.unmapped) || (filter.status === "unresolved" && review.unresolved);
  return countMatches && groupsMatch && statusMatches;
}

export interface MembershipChange {
  memberId: string; name: string; email: string; groupId: string; groupName: string;
  action: MembershipAction; before: string[]; after: string[];
}

export function buildMembershipPlan(members: Member[], groups: WorkspaceGroup[], groupId: string, action: MembershipAction): MembershipChange[] {
  const target = groups.find((group) => group.id === groupId);
  if (!target || target.source !== "Manual") throw new Error("Choose a manual group. SCIM membership is read-only.");
  return members.flatMap((member) => {
    const before = currentGroupIds(member, groups);
    if (before.some((id) => !groups.some((group) => group.id === id)) || (!member.groupIds && before.length !== new Set(member.groups).size)) {
      throw new Error(`Refresh the directory before editing ${member.name}: a membership could not be resolved.`);
    }
    const present = before.includes(groupId);
    if ((action === "add" && present) || (action === "remove" && !present)) return [];
    return [{ memberId: member.id, name: member.name, email: member.email, groupId, groupName: target.name, action,
      before, after: action === "add" ? [...before, groupId].sort() : before.filter((id) => id !== groupId) }];
  });
}

export function validateExclusiveSets(value: unknown, validIds: Set<string>): ExclusiveGroupSet[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Provide up to 50 exclusive group sets.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim() || item.id.length > 100 || seen.has(item.id)) throw new Error("Each exclusive set needs a unique ID.");
    if (typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 100) throw new Error("Each exclusive set needs a name (up to 100 characters).");
    if (!Array.isArray(item.groupIds) || !item.groupIds.every((id: unknown) => typeof id === "string" && validIds.has(id))) throw new Error("Choose groups from the current snapshot.");
    const groupIds = [...new Set<string>(item.groupIds)];
    if (groupIds.length < 2) throw new Error("An exclusive set needs at least two different groups.");
    seen.add(item.id);
    return { id: item.id, name: item.name.trim(), groupIds };
  });
}
