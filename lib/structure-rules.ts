import type { Member, MemberStructureContext, StructureGroupRule } from "../app/types";
import type { PeopleProfile } from "./people-api";

const normalizedEmail = (value?: string) => String(value ?? "").trim().toLowerCase();
function personId(person: PeopleProfile) { return String(person.id ?? person.personNumber ?? "").trim(); }

/** Resolve identities and the entire reporting chain, never manager display names. */
export function resolveStructureContext(people: PeopleProfile[], members: Pick<Member, "id" | "email">[], rules: StructureGroupRule[], leaderId?: string) {
  const byId = new Map<string, PeopleProfile>();
  const byEmail = new Map<string, PeopleProfile[]>();
  for (const person of people) {
    const id = personId(person);
    if (!id || byId.has(id)) throw new Error("People API hierarchy has missing or duplicate person IDs. Structure rules require a complete directory.");
    byId.set(id, person);
    const email = normalizedEmail(person.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), person]);
  }
  if (rules.some((rule) => !byId.has(rule.managerId))) throw new Error("A configured structure manager is missing from People API. Review the saved rules before assigning groups.");
  if (leaderId && !byId.has(leaderId)) throw new Error("The configured reporting-tree anchor is missing from People API.");
  const workspaceEmails = new Map<string, number>();
  for (const member of members) {
    const email = normalizedEmail(member.email);
    workspaceEmails.set(email, (workspaceEmails.get(email) ?? 0) + 1);
  }
  const result: Record<string, MemberStructureContext> = Object.create(null);
  for (const member of members) {
    const ancestors: string[] = [];
    let problem: string | null = null;
    const email = normalizedEmail(member.email);
    const matches = byEmail.get(email) ?? [];
    if (matches.length !== 1 || workspaceEmails.get(email) !== 1) {
      problem = "Structure unresolved: an exact, unique People API and workspace email match is required.";
    } else if (matches[0].isActive !== true) {
      problem = "Structure unresolved: People API profile is inactive or its active status is unknown.";
    } else {
      let current = matches[0];
      const visited = new Set([personId(current)]);
      while (current.manager) {
        const managerId = String(current.manager.id ?? "").trim();
        if (!managerId || !byId.has(managerId) || visited.has(managerId)) {
          problem = "Structure unresolved: the reporting chain contains a cycle, missing manager ID, or missing profile.";
          break;
        }
        visited.add(managerId);
        ancestors.push(managerId);
        current = byId.get(managerId)!;
      }
    }
    result[member.id] = { personId: problem ? null : personId(matches[0]), ancestorIds: problem ? [] : ancestors, problem,
      ...(leaderId ? { leaderId } : {}) };
  }
  return result;
}

/** Same N-1 ownership rule as structure coverage: the direct child below root. */
export function n1HeadIdForContext(context: MemberStructureContext, rootId: string): string | null {
  if (context.problem || !context.personId || !rootId) return null;
  const chain = [context.personId, ...context.ancestorIds];
  const rootIndex = chain.indexOf(rootId);
  return rootIndex > 0 ? chain[rootIndex - 1] : null;
}
