import type { Member, OrganizerMappings, OrganizerStructureContext } from "../app/types";
import { getDirectorySnapshot, profileId } from "./people-api";
import { n1HeadIdForContext, resolveStructureContext } from "./structure-rules";

export async function getOrganizerStructureContext(baseUrl: string, members: Member[], rules: OrganizerMappings, fresh = false, leaderName = "David Roberts"): Promise<OrganizerStructureContext> {
  try {
    const snapshot = await getDirectorySnapshot(baseUrl, { fresh });
    const leaders = snapshot.people.filter((person) => String(person.displayName ?? "").trim().toLocaleLowerCase() === leaderName.trim().toLocaleLowerCase());
    const leader = leaders.length === 1 ? leaders[0] : null;
    const leaderId = profileId(leader) ?? "";
    const rootId = String(leader?.manager?.id ?? "").trim();
    const root = snapshot.people.find((person) => profileId(person) === rootId);
    const n1Heads = root ? snapshot.people.filter((person) => String(person.manager?.id ?? "").trim() === rootId && profileId(person) !== rootId)
      .map((person) => ({ id: profileId(person)!, name: person.displayName || "Unnamed manager" }))
      .sort((left, right) => left.name.localeCompare(right.name)) : [];
    const contexts = resolveStructureContext(snapshot.people, members, rules.structureRules ?? [], leaderId || undefined);
    const scopedContexts = Object.fromEntries(Object.entries(contexts).map(([id, context]) => [id, {
      ...context, n1HeadId: root ? n1HeadIdForContext(context, rootId) : null,
    }]));
    // A missing David anchor blocks only scoped title rules. Other verified
    // manager-structure rules can still be reviewed and applied.
    return { members: scopedContexts, retrievedAt: snapshot.retrievedAt,
      error: leaderId ? null : `${leaderName} is missing or ambiguous in People API. Scoped job-title rules are blocked.`, leaderName,
      n1Heads, n1Error: root ? null : `Cannot determine ${leaderName}'s parent in People API, so N-1 filtering is unavailable.` };
  } catch {
    // Do not fall through to a job-title rule when the higher-priority hierarchy
    // cannot be verified. Domain rules and explicit manual moves remain independent.
    const error = `People API reporting structure for ${leaderName} is unavailable or incomplete. Check the connection and exact manager identity, then refresh. Scoped job-title assignments are blocked.`;
    return { members: Object.fromEntries(members.map((member) => [member.id, { personId: null, ancestorIds: [], problem: error, leaderId: null, n1HeadId: null }])), retrievedAt: null, error, leaderName, n1Heads: [], n1Error: error };
  }
}
