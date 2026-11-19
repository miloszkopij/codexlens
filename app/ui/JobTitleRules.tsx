"use client";
import { useState } from "react";
import type { DashboardData, Member, OrganizerMappings, WorkspaceGroup } from "../types";
import { emailDomain, hasNoRegularGroup, leaderScope, scopedRoleGroups, titleMatchesWords, type LeaderScope } from "../../lib/access-policy";
import { useStructureContext } from "./useStructureContext";

type StructureView = ReturnType<typeof useStructureContext>;
type SegmentFilter = "all" | LeaderScope;
type AssignmentFilter = "all" | "no-rule" | "no-regular-group" | "either";

export default function JobTitleRules({ data, rules, targets, structures, query, statusFilter, disabled, onRuleChange, onBulkRuleChange, onSelectMember }: {
  data: DashboardData;
  rules: OrganizerMappings;
  targets: WorkspaceGroup[];
  structures: StructureView;
  query: string;
  statusFilter: string;
  disabled: boolean;
  onRuleChange: (title: string, scope: LeaderScope, groupId: string) => void;
  onBulkRuleChange: (rows: { title: string; scope: LeaderScope }[], groupId: string) => void;
  onSelectMember: (member: Member) => void;
}) {
  const [domainFilter, setDomainFilter] = useState("");
  const [headFilter, setHeadFilter] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [bulkGroup, setBulkGroup] = useState("");
  const verified = data.mode !== "demo" && !structures.loading && !structures.error;
  const domains = [...new Set(data.members.map((member) => emailDomain(member.email)).filter(Boolean))].sort();
  const titles = [...new Set([
    ...data.members.map((member) => member.peopleRole).filter((title): title is string => Boolean(title)),
    ...Object.keys(rules.roleToGroups),
    ...Object.keys(rules.roleToGroupsInLeaderStructure ?? {}),
    ...Object.keys(rules.roleToGroupsOutsideLeaderStructure ?? {}),
  ])].sort();
  const headNames = new Map(structures.n1Heads.map((head) => [head.id, head.name]));
  const unassignedIds = new Set(data.members.filter((member) => hasNoRegularGroup(member, data.groups)).map((member) => member.id));
  const cohortFiltered = Boolean(domainFilter || headFilter || segmentFilter !== "all");
  const rows = titles.flatMap((title) => (["inside", "outside"] as LeaderScope[]).flatMap((scope) => {
    if (segmentFilter !== "all" && scope !== segmentFilter) return [];
    const titleMembers = data.members.filter((member) => member.peopleRole === title);
    const people = verified ? titleMembers.filter((member) =>
      leaderScope(structures.members?.[member.id]) === scope
      && (!domainFilter || emailDomain(member.email) === domainFilter)
      && (!headFilter || structures.members?.[member.id]?.n1HeadId === headFilter),
    ) : [];
    const ids = scopedRoleGroups(rules, title, scope);
    const unassignedCount = people.filter((member) => unassignedIds.has(member.id)).length;
    const invalid = ids.length > 1 || ids.some((id) => !targets.some((group) => group.id === id));
    const scoped = scope === "inside" ? rules.roleToGroupsInLeaderStructure : rules.roleToGroupsOutsideLeaderStructure;
    const hasVisiblePeople = verified ? people.length > 0 : titleMembers.some((member) => !domainFilter || emailDomain(member.email) === domainFilter);
    const retainEmpty = !cohortFiltered && (Object.hasOwn(scoped ?? {}, title) || !titleMembers.length || !verified);
    if (!hasVisiblePeople && !retainEmpty) return [];
    if (!titleMatchesWords(title, query)) return [];
    if (statusFilter === "unmapped" && ids.length) return [];
    if (statusFilter === "mapped" && (ids.length !== 1 || invalid)) return [];
    if (statusFilter === "conflict" && !invalid) return [];
    if (assignmentFilter === "no-rule" && ids.length) return [];
    if (assignmentFilter === "no-regular-group" && !unassignedCount) return [];
    if (assignmentFilter === "either" && ids.length && !unassignedCount) return [];
    return [{ title, scope, people, ids, invalid, unassignedCount }];
  }));
  const bulkRows = verified && query.trim() ? rows : [];
  const unverifiedCount = data.members.filter((member) => member.peopleRole && !leaderScope(structures.members?.[member.id])).length;
  const selectedRow = rows.find((row) => `${row.title}:${row.scope}` === expanded);
  const matchingPeople = selectedRow?.people.filter((member) =>
    `${member.name} ${member.email} ${member.department ?? ""} ${member.manager ?? ""} ${member.entity} ${member.groups.join(" ")}`
      .toLowerCase().includes(personQuery.trim().toLowerCase()),
  ).sort((left, right) => left.name.localeCompare(right.name)) ?? [];

  return <section className="panel job-title-rules"><div className="panel-heading"><div><span className="eyebrow">Priority 4 · fallback</span><h2>People API job title → regular group</h2></div></div>
    <p className="table-note">Tech = {structures.leaderName} and everyone in his reporting structure; Non-tech = everyone outside it. Existing title rules are the default for both until you change a row. Email-domain and explicit structure rules still take priority. Special groups are never rule destinations. {unverifiedCount && verified ? `${unverifiedCount} people cannot be classified and are excluded from counts.` : ""}</p>
    <div className="job-title-filters" aria-label="Job title view filters">
      <label>Email domain<select aria-label="Filter job titles by email domain" value={domainFilter} onChange={(event) => { setDomainFilter(event.target.value); setExpanded(null); }}><option value="">All domains</option>{domains.map((domain) => <option key={domain} value={domain}>@{domain}</option>)}</select></label>
      <label>N-1 head<select aria-label="Filter job titles by N-1 head" value={headFilter} disabled={!verified || Boolean(structures.n1Error)} onChange={(event) => { setHeadFilter(event.target.value); setExpanded(null); }}><option value="">All N-1 heads</option>{structures.n1Heads.map((head) => <option key={head.id} value={head.id}>{head.name}</option>)}</select></label>
      <label>Segment<select aria-label="Filter job titles by Tech or Non-tech" value={segmentFilter} disabled={!verified} onChange={(event) => { setSegmentFilter(event.target.value as SegmentFilter); setExpanded(null); }}><option value="all">Tech + Non-tech</option><option value="inside">Tech</option><option value="outside">Non-tech</option></select></label>
      <label>Rule / assignment<select aria-label="Filter job titles by rule or assignment" value={assignmentFilter} onChange={(event) => { setAssignmentFilter(event.target.value as AssignmentFilter); setExpanded(null); }}><option value="all">All rows</option><option value="no-rule">No title rule</option><option value="no-regular-group">People without regular group</option><option value="either">No rule or unassigned people</option></select></label>
      <button className="button button--secondary" disabled={!cohortFiltered && assignmentFilter === "all"} onClick={() => { setDomainFilter(""); setHeadFilter(""); setSegmentFilter("all"); setAssignmentFilter("all"); setExpanded(null); }}>Clear filters</button>
    </div>
    <p className="job-title-filter-note">{verified ? `${rows.length} title/segment rows and ${rows.reduce((sum, row) => sum + row.unassignedCount, 0)} people without a regular group in view. N-1 heads are direct reports of ${structures.leaderName}'s manager, including ${structures.leaderName}. Counts reflect these filters; saved rules still apply to everyone.` : "People API structure verification is required for segment, N-1 and people lookup."} “No title rule” checks the effective Tech/Non-tech rule; “People without regular group” checks current membership, even if another rule could assign them. {structures.n1Error && !structures.loading ? structures.n1Error : ""}</p>
    <div className="job-title-bulk"><div><strong>Bulk assign matching titles</strong><small>Search by one or more words above, then set all {bulkRows.length} visible title/segment rows, including rows with zero current people. Bulk edits the whole row, not only unassigned people. This edits the draft only; save and review before applying memberships.</small></div><select aria-label="Bulk destination for matching job titles" value={bulkGroup} disabled={disabled} onChange={(event) => setBulkGroup(event.target.value)}><option value="">Choose a group</option>{targets.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}<option value="__clear__">No rule (clear matches)</option></select><button className="button button--secondary" disabled={disabled || !bulkGroup || !bulkRows.length} onClick={() => onBulkRuleChange(bulkRows.map(({ title, scope }) => ({ title, scope })), bulkGroup === "__clear__" ? "" : bulkGroup)}>{bulkGroup === "__clear__" ? `Clear ${bulkRows.length} matching rows` : `Assign ${bulkRows.length} matching rows`}</button></div>
    <div className="table-scroll"><table className="policy-table policy-title-table"><thead><tr><th>Job title</th><th>Segment</th><th>People</th><th>Without regular</th><th>Destination</th></tr></thead><tbody>{rows.map(({ title, scope, people, ids, invalid, unassignedCount }) => {
      const key = `${title}:${scope}`;
      return <FragmentRow key={key} title={title} scope={scope} people={people} unassignedCount={unassignedCount} ids={ids} invalid={invalid} expanded={expanded === key} verified={verified} targets={targets} disabled={disabled} leaderName={structures.leaderName} onRuleChange={onRuleChange} onExpand={() => { setExpanded(expanded === key ? null : key); setPersonQuery(""); }} detail={expanded === key ? <div className="job-title-people"><div className="job-title-people-heading"><strong>{title} · {scope === "inside" ? "Tech" : "Non-tech"} · {people.length} people</strong><input aria-label={`Search people with job title ${title}`} placeholder="Find a person, department or manager" value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} /></div><div className="job-title-people-list">{matchingPeople.map((member) => {
        const context = structures.members?.[member.id];
        return <div key={member.id} className="job-title-person"><div><button className="text-button" onClick={() => onSelectMember(member)}>{member.name}</button><small>{member.email} · @{emailDomain(member.email)} · {member.entity}</small></div><div><strong>People API</strong><small>{member.peopleRole || "No job title"} · {member.department || "No department"}<br />Manager: {member.manager || "Unknown"}<br />N-1: {context?.n1HeadId ? headNames.get(context.n1HeadId) || "Unknown" : "Outside N-1"} · {member.peopleMatch}</small></div><div><strong>Current groups</strong><small>{member.groups.join(", ") || "None"}{unassignedIds.has(member.id) ? " · No regular group" : ""}</small></div></div>;
      })}{!matchingPeople.length && <p className="empty-state">No people match this search.</p>}</div><small>People details come from the last workspace sync; reporting hierarchy was verified {structures.retrievedAt ? new Date(structures.retrievedAt).toLocaleString() : "recently"}.</small></div> : null} />;
    })}</tbody></table>{!rows.length && <div className="empty-state">No job titles match these filters.</div>}</div>
  </section>;
}

function FragmentRow({ title, scope, people, unassignedCount, ids, invalid, expanded, verified, targets, disabled, leaderName, onRuleChange, onExpand, detail }: {
  title: string; scope: LeaderScope; people: Member[]; unassignedCount: number; ids: string[]; invalid: boolean; expanded: boolean; verified: boolean;
  targets: WorkspaceGroup[]; disabled: boolean; leaderName: string; onRuleChange: (title: string, scope: LeaderScope, groupId: string) => void;
  onExpand: () => void; detail: React.ReactNode;
}) {
  return <><tr><td>{title}</td><td>{scope === "inside" ? "Tech" : "Non-tech"}</td><td>{verified && people.length ? <button className="text-button job-title-count" aria-label={`View ${people.length} ${people.length === 1 ? "person" : "people"} with job title ${title} in ${scope === "inside" ? "Tech" : "Non-tech"}`} aria-expanded={expanded} onClick={onExpand}>{people.length} {expanded ? "▴" : "▾"}</button> : verified ? 0 : "—"}</td><td>{verified ? unassignedCount : "—"}</td><td><select aria-label={`Destination for ${title} ${scope === "inside" ? "inside" : "outside"} ${leaderName} structure`} disabled={disabled} value={invalid ? "__review__" : ids[0] ?? ""} onChange={(event) => onRuleChange(title, scope, event.target.value)}><option value="">No rule</option>{invalid && <option value="__review__" disabled>Review legacy targets ({ids.length})</option>}{targets.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></td></tr>{expanded && <tr className="job-title-detail-row"><td colSpan={5}>{detail}</td></tr>}</>;
}
