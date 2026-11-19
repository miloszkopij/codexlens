import type { Entity } from "../app/types";
import type { PeopleProfile } from "./people-api";
import type { WorkspaceRoleMember } from "./workspace-roles";

export interface StructureCoverageRow {
  id: string; name: string; title: string; leaderActive: boolean; totalPeople: number;
  workspacePeople: number; chatgptSeats: number; codexSeats: number; unknownSeats: number;
  activeUsers: number; coverage: number | null;
}
export interface StructureCoverageData {
  root: { id: string; name: string }; anchor: { id: string; name: string };
  startDate: string; endDate: string; peopleAsOf: string; workspaceAsOf: string; usageSource: string;
  rows: StructureCoverageRow[];
  totals: { totalPeople: number; workspacePeople: number; chatgptSeats: number; codexSeats: number; unknownSeats: number; activeUsers: number };
  quality: { unmatched: number; ambiguous: number; inactive: number; outside: number; brokenHierarchy: number; duplicateAccounts: number; excludedInactivePeople: number; unresolvedDirectoryPeople: number };
  entity: Entity | null; groupId: string | null; groupName: string | null;
}

function id(person?: PeopleProfile | PeopleProfile["manager"] | null) { return person?.id || (person && "personNumber" in person ? String(person.personNumber ?? "") : ""); }
export function activePerson(person: PeopleProfile) { return person.isActive === true; }
function email(value?: string) { return String(value ?? "").trim().toLowerCase(); }
function entityOf(person: PeopleProfile): Entity {
  const value = `${person.company ?? ""} ${person.email ?? ""}`.toLowerCase();
  return /ebilet|e-bilet/.test(value) ? "eBilet" : value.includes("ceneo") ? "Ceneo" : value.includes("allegro") ? "Allegro" : "Unknown";
}

export function calculateStructureCoverage(input: {
  people: PeopleProfile[]; rootId: string; members: WorkspaceRoleMember[]; activeUserIds: Set<string>;
  entity?: Entity | null; groupMemberIds?: Set<string> | null;
}) {
  const { people, rootId, members, activeUserIds, entity, groupMemberIds } = input;
  const byId = new Map<string, PeopleProfile>();
  const duplicateIds = new Set<string>();
  for (const person of people) {
    const key = id(person); if (!key) continue;
    if (byId.has(key)) duplicateIds.add(key);
    byId.set(key, person);
  }
  if (!byId.has(rootId) || duplicateIds.size || people.some((person) => !id(person))) throw new Error("People API directory contains missing or duplicate IDs, or lacks the root manager. Coverage is unavailable until the directory is complete.");
  const leaders = people.filter((person) => id(person.manager) === rootId && id(person) !== rootId);
  const leaderIds = new Set(leaders.map((person) => id(person)));
  const owners = new Map<string, string | "outside" | "broken">();
  function owner(person: PeopleProfile): string | "outside" | "broken" {
    const personId = id(person);
    const cached = owners.get(personId); if (cached) return cached;
    let current = personId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return "broken";
      visited.add(current);
      if (leaderIds.has(current)) { owners.set(personId, current); return current; }
      if (current === rootId) { owners.set(personId, "outside"); return "outside"; }
      const profile = byId.get(current);
      if (!profile) return "broken";
      current = id(profile.manager);
      if (!current) { owners.set(personId, "outside"); return "outside"; }
    }
    return "broken";
  }
  const rows = new Map(leaders.map((person) => [id(person), {
    id: id(person), name: person.displayName ?? "Unnamed leader", title: person.title ?? "", leaderActive: activePerson(person),
    totalPeople: 0, workspacePeople: 0, chatgptSeats: 0, codexSeats: 0, unknownSeats: 0, activeUsers: 0, coverage: null,
  } as StructureCoverageRow]));
  const byEmail = new Map<string, PeopleProfile[]>();
  for (const person of people) {
    const key = email(person.email); if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), person]);
    const row = rows.get(owner(person));
    if (row && activePerson(person) && (!entity || entityOf(person) === entity)) row.totalPeople++;
  }
  const quality = { unmatched: 0, ambiguous: 0, inactive: 0, outside: 0, brokenHierarchy: 0, duplicateAccounts: 0,
    excludedInactivePeople: people.filter((person) => !activePerson(person) && (!entity || entityOf(person) === entity)).length,
    unresolvedDirectoryPeople: people.filter((person) => activePerson(person) && (!entity || entityOf(person) === entity) && owner(person) === "broken").length };
  const workspaceEmails = new Map<string, number>();
  for (const member of members) { const key = email(member.email); if (key) workspaceEmails.set(key, (workspaceEmails.get(key) ?? 0) + 1); }
  for (const member of members) {
    if (groupMemberIds && !groupMemberIds.has(member.id)) continue;
    const matches = byEmail.get(email(member.email)) ?? [];
    if (!matches.length) { quality.unmatched++; continue; }
    if (matches.length > 1) { quality.ambiguous++; continue; }
    if ((workspaceEmails.get(email(member.email)) ?? 0) > 1) { quality.duplicateAccounts++; continue; }
    const person = matches[0];
    if (entity && entityOf(person) !== entity) continue;
    if (!activePerson(person)) { quality.inactive++; continue; }
    const ownerId = owner(person);
    if (ownerId === "broken") { quality.brokenHierarchy++; continue; }
    const row = rows.get(ownerId);
    if (!row) { quality.outside++; continue; }
    row.workspacePeople++;
    if (member.seatType === "chatgpt") row.chatgptSeats++;
    else if (member.seatType === "codex") row.codexSeats++;
    else row.unknownSeats++;
    if (activeUserIds.has(member.id)) row.activeUsers++;
  }
  for (const row of rows.values()) row.coverage = row.totalPeople ? row.workspacePeople / row.totalPeople : null;
  const resultRows = [...rows.values()].sort((a, b) => b.totalPeople - a.totalPeople || a.name.localeCompare(b.name));
  const totals = resultRows.reduce((total, row) => ({ totalPeople: total.totalPeople + row.totalPeople, workspacePeople: total.workspacePeople + row.workspacePeople, chatgptSeats: total.chatgptSeats + row.chatgptSeats, codexSeats: total.codexSeats + row.codexSeats, unknownSeats: total.unknownSeats + row.unknownSeats, activeUsers: total.activeUsers + row.activeUsers }), { totalPeople: 0, workspacePeople: 0, chatgptSeats: 0, codexSeats: 0, unknownSeats: 0, activeUsers: 0 });
  return { rows: resultRows, totals, quality };
}
