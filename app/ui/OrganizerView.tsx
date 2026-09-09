"use client";

import {
  Building2, Check, ChevronRight, GitCompareArrows, Group, LoaderCircle,
  Save, Search, ShieldCheck, SlidersHorizontal, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { classifyPeopleRole, type ManagedTargetGroup } from "../../lib/role-rules";
import type { DashboardData, Entity, Member, OrganizerMappings, WorkspaceGroup } from "../types";

type EntityFilter = "All" | Entity;
type AssignmentMode = "rules" | `group:${string}`;
type StatusFilter = "all" | "ready" | "review" | "assigned";
type RuleTargetFilter = "All" | ManagedTargetGroup | "Review";
type PlanStatus = Exclude<StatusFilter, "all"> | "blocked";
type OrganizerTab = "assignments" | "mappings";

type PlanRow = {
  member: Member;
  target: WorkspaceGroup | null;
  suggestedTarget: ManagedTargetGroup | null;
  status: PlanStatus;
  reason: string;
};

type MappedAssignment = {
  key: string;
  member: Member;
  target: WorkspaceGroup;
  reasons: string[];
};

const entities: EntityFilter[] = ["All", "Allegro", "eBilet", "Ceneo", "Unknown"];
const managedTargets: ManagedTargetGroup[] = ["PM", "Developers", "white-collar", "SEC"];
const entityColors: Record<Entity, string> = {
  Allegro: "#f36f35", eBilet: "#ef4c66", Ceneo: "#27a7e8", Unknown: "#888a8d",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function buildPlanRow(member: Member, groups: WorkspaceGroup[], mode: AssignmentMode): PlanRow {
  const suggestedTarget = classifyPeopleRole(member.peopleRole);
  if (member.peopleMatch !== "Matched" || !member.peopleRole) {
    return { member, target: null, suggestedTarget, status: "review", reason: member.peopleMatch === "Ambiguous" ? "Ambiguous People API match" : "People API role missing" };
  }

  const target = mode === "rules"
    ? groups.find((group) => group.name.toLowerCase() === suggestedTarget?.toLowerCase()) ?? null
    : groups.find((group) => group.id === mode.slice("group:".length)) ?? null;
  if (mode === "rules" && !suggestedTarget) return { member, target: null, suggestedTarget, status: "review", reason: "Role needs a group decision" };
  if (!target) return { member, target: null, suggestedTarget, status: "blocked", reason: mode === "rules" ? `${suggestedTarget} group is unavailable` : "Selected group is unavailable" };
  if (target.source === "SCIM") return { member, target, suggestedTarget, status: "blocked", reason: "Target group is SCIM-managed" };
  if (member.groups.some((group) => group.toLowerCase() === target.name.toLowerCase())) return { member, target, suggestedTarget, status: "assigned", reason: "Already in target group" };
  return { member, target, suggestedTarget, status: "ready", reason: mode === "rules" ? "Ready from role rule" : "Ready for your selected group" };
}

function statusPill(row: PlanRow) {
  if (row.status === "ready") return <span className="pill pill--green">Ready</span>;
  if (row.status === "assigned") return <span className="pill pill--neutral">Already assigned</span>;
  return <span className="pill pill--warning">{row.status === "blocked" ? "Blocked" : "Review"}</span>;
}

function GroupMultiSelect({ groups, selected, onToggle, label }: {
  groups: WorkspaceGroup[];
  selected: string[];
  onToggle: (groupId: string) => void;
  label: string;
}) {
  return <div className="mapping-multi-select" aria-label={label}>{groups.map((group) => {
    const checked = selected.includes(group.id);
    return <label key={group.id} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={() => onToggle(group.id)} /><span>{group.name}</span></label>;
  })}</div>;
}

function buildMappedAssignments(members: Member[], groups: WorkspaceGroup[], mappings: OrganizerMappings) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const plan = new Map<string, MappedAssignment>();
  for (const member of members) {
    if (member.peopleMatch !== "Matched") continue;
    const candidates: Array<{ groupIds?: string[]; reason: string }> = [];
    if (member.peopleRole) candidates.push({ groupIds: mappings.roleToGroups[member.peopleRole], reason: `Role: ${member.peopleRole}` });
    candidates.push({ groupIds: mappings.entityToGroups[member.entity], reason: `Entity: ${member.entity}` });
    for (const candidate of candidates) {
      for (const groupId of candidate.groupIds ?? []) {
        const target = groupsById.get(groupId);
        if (!target || target.source !== "Manual" || member.groups.some((group) => group.toLowerCase() === target.name.toLowerCase())) continue;
        const key = `${member.id}:${target.id}`;
        const existing = plan.get(key);
        if (existing) existing.reasons.push(candidate.reason);
        else plan.set(key, { key, member, target, reasons: [candidate.reason] });
      }
    }
  }
  return [...plan.values()].sort((a, b) => a.target.name.localeCompare(b.target.name) || a.member.name.localeCompare(b.member.name));
}

export default function OrganizerView({ data, onSelectMember, onRefresh, onNotice }: {
  data: DashboardData;
  onSelectMember: (member: Member) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [organizerTab, setOrganizerTab] = useState<OrganizerTab>("assignments");
  const [entity, setEntity] = useState<EntityFilter>("All");
  const [role, setRole] = useState("All");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<AssignmentMode>("rules");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ruleTarget, setRuleTarget] = useState<RuleTargetFilter>("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [mappings, setMappings] = useState<OrganizerMappings>({ roleToGroups: {}, entityToGroups: {} });
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [mappingsDirty, setMappingsDirty] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingConfirming, setMappingConfirming] = useState(false);
  const [mappingQuery, setMappingQuery] = useState("");
  const [mappingFilter, setMappingFilter] = useState<"all" | "unmapped" | "single" | "multiple">("all");

  const roles = useMemo(() => [...new Set(data.members.map((member) => member.peopleRole).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)), [data.members]);
  const writableGroups = data.groups.filter((group) => group.source === "Manual");
  const mappedAssignments = useMemo(() => buildMappedAssignments(data.members, data.groups, mappings), [data, mappings]);
  const mappedPeopleCount = new Set(mappedAssignments.map((assignment) => assignment.member.id)).size;
  const mappedDistribution = mappedAssignments.reduce((counts, assignment) => {
    counts.set(assignment.target.name, (counts.get(assignment.target.name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const roleMappingRows = useMemo(() => roles.map((title) => ({
    title,
    members: data.members.filter((member) => member.peopleMatch === "Matched" && member.peopleRole === title).length,
    recommendation: classifyPeopleRole(title),
  })), [data.members, roles]);
  const filteredRoleMappingRows = useMemo(() => roleMappingRows.filter((row) => {
    const count = mappings.roleToGroups[row.title]?.length ?? 0;
    const matchesQuery = !mappingQuery.trim() || row.title.toLowerCase().includes(mappingQuery.trim().toLowerCase());
    const matchesFilter = mappingFilter === "all" || (mappingFilter === "unmapped" && count === 0) || (mappingFilter === "single" && count === 1) || (mappingFilter === "multiple" && count > 1);
    return matchesQuery && matchesFilter;
  }), [mappingFilter, mappingQuery, mappings.roleToGroups, roleMappingRows]);
  const allRuleRows = useMemo(() => data.members.map((member) => buildPlanRow(member, data.groups, "rules")), [data]);
  const rows = useMemo(() => data.members
    .map((member) => buildPlanRow(member, data.groups, mode))
    .filter((row) => entity === "All" || row.member.entity === entity)
    .filter((row) => {
      if (role === "All") return true;
      if (role === "Missing or ambiguous") return row.member.peopleMatch !== "Matched" || !row.member.peopleRole;
      return row.member.peopleRole === role;
    })
    .filter((row) => {
      const normalized = query.trim().toLowerCase();
      return !normalized || [row.member.name, row.member.email, row.member.peopleRole ?? "", row.member.department ?? "", row.member.entity, ...row.member.groups].join(" ").toLowerCase().includes(normalized);
    })
    .filter((row) => status === "all" || (status === "review" ? row.status === "review" || row.status === "blocked" : row.status === status))
    .filter((row) => mode !== "rules" || ruleTarget === "All" || (ruleTarget === "Review" ? row.status === "review" || row.status === "blocked" : row.suggestedTarget === ruleTarget))
    .sort((a, b) => Number(b.status === "review" || b.status === "blocked") - Number(a.status === "review" || a.status === "blocked") || a.member.name.localeCompare(b.member.name)),
  [data, entity, mode, query, role, ruleTarget, status]);

  const readyRows = rows.filter((row) => row.status === "ready");
  const selectedRows = rows.filter((row) => row.status === "ready" && selected.has(row.member.id));
  const reviewCount = allRuleRows.filter((row) => row.status === "review" || row.status === "blocked").length;
  const ruleCounts = managedTargets.map((target) => ({
    target,
    count: allRuleRows.filter((row) => row.suggestedTarget === target && row.status === "ready").length,
  }));
  const distribution = selectedRows.reduce((counts, row) => {
    const name = row.target?.name ?? "Unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/organizer-mappings")
      .then(async (response) => { const payload = await response.json() as OrganizerMappings & { error?: string }; if (!response.ok) throw new Error(payload.error || "Could not load mappings."); return payload; })
      .then((payload) => { if (!cancelled) { setMappings(payload); setMappingsLoaded(true); setMappingsDirty(false); } })
      .catch((reason) => { if (!cancelled) { setMappingsLoaded(true); onNotice(reason instanceof Error ? reason.message : "Could not load mappings."); } });
    return () => { cancelled = true; };
  }, [onNotice]);

  function toggle(memberId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    });
  }

  function toggleAllVisible() {
    const allSelected = readyRows.length > 0 && readyRows.every((row) => selected.has(row.member.id));
    setSelected(allSelected ? new Set() : new Set(readyRows.map((row) => row.member.id)));
  }

  async function applySelected() {
    const assignments = selectedRows.map((row) => ({ member: row.member, target: row.target as WorkspaceGroup }));
    setApplying(true); setProgress({ done: 0, total: assignments.length });
    const failures: Array<{ id: string; message: string }> = [];
    let applied = 0;
    for (let index = 0; index < assignments.length; index += 3) {
      const batch = assignments.slice(index, index + 3);
      const outcomes = await Promise.all(batch.map(async ({ member, target }) => {
        try {
          const response = await fetch("/api/group-membership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: member.id, groupId: target.id, action: "add" }) });
          const payload = await response.json() as { error?: string };
          if (!response.ok) throw new Error(payload.error || "Group update failed");
          return { id: member.id, ok: true, message: "" };
        } catch (reason) {
          return { id: member.id, ok: false, message: reason instanceof Error ? reason.message : "Group update failed" };
        }
      }));
      for (const outcome of outcomes) {
        if (outcome.ok) applied += 1; else failures.push({ id: outcome.id, message: outcome.message });
      }
      setProgress({ done: Math.min(index + batch.length, assignments.length), total: assignments.length });
    }
    setSelected(new Set(failures.map((failure) => failure.id)));
    setConfirming(false);
    try {
      if (applied) await onRefresh();
      const firstError = failures[0]?.message;
      onNotice(`${applied} group ${applied === 1 ? "assignment" : "assignments"} applied${failures.length ? `; ${failures.length} failed${firstError ? ` (${firstError})` : ""}` : ""}.`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "Assignments were applied, but the saved workspace could not be refreshed.");
    } finally {
      setApplying(false);
    }
  }

  function updateRoleMapping(title: string, groupId: string) {
    setMappings((current) => {
      const roleToGroups = { ...current.roleToGroups };
      const next = new Set(roleToGroups[title] ?? []);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      if (next.size) roleToGroups[title] = [...next]; else delete roleToGroups[title];
      return { ...current, roleToGroups };
    });
    setMappingsDirty(true);
  }

  function updateEntityMapping(entityName: Entity, groupId: string) {
    setMappings((current) => {
      const entityToGroups = { ...current.entityToGroups };
      const next = new Set(entityToGroups[entityName] ?? []);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      if (next.size) entityToGroups[entityName] = [...next]; else delete entityToGroups[entityName];
      return { ...current, entityToGroups };
    });
    setMappingsDirty(true);
  }

  function useRoleRecommendations() {
    setMappings((current) => {
      const roleToGroups = { ...current.roleToGroups };
      for (const row of roleMappingRows) {
        const group = writableGroups.find((candidate) => candidate.name.toLowerCase() === row.recommendation?.toLowerCase());
        if (group) roleToGroups[row.title] = [...new Set([...(roleToGroups[row.title] ?? []), group.id])];
      }
      return { ...current, roleToGroups };
    });
    setMappingsDirty(true);
  }

  async function saveMappings(announce = true) {
    setMappingSaving(true);
    try {
      const response = await fetch("/api/organizer-mappings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mappings) });
      const payload = await response.json() as OrganizerMappings & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save mappings.");
      setMappings(payload); setMappingsDirty(false);
      if (announce) onNotice("Role and entity mappings saved locally.");
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "Could not save mappings.");
      return false;
    } finally {
      setMappingSaving(false);
    }
  }

  async function reviewMappedAssignments() {
    if (mappingsDirty && !(await saveMappings(false))) return;
    setMappingConfirming(true);
  }

  async function applyMappedAssignments() {
    const assignments = [...mappedAssignments];
    setApplying(true); setProgress({ done: 0, total: assignments.length });
    const failures: string[] = [];
    let applied = 0;
    for (let index = 0; index < assignments.length; index += 3) {
      const batch = assignments.slice(index, index + 3);
      const outcomes = await Promise.all(batch.map(async (assignment) => {
        try {
          const response = await fetch("/api/group-membership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: assignment.member.id, groupId: assignment.target.id, action: "add" }) });
          const payload = await response.json() as { error?: string };
          if (!response.ok) throw new Error(payload.error || "Group update failed");
          return { key: assignment.key, ok: true, message: "" };
        } catch (reason) {
          return { key: assignment.key, ok: false, message: reason instanceof Error ? reason.message : "Group update failed" };
        }
      }));
      for (const outcome of outcomes) {
        if (outcome.ok) applied += 1; else failures.push(outcome.message);
      }
      setProgress({ done: Math.min(index + batch.length, assignments.length), total: assignments.length });
    }
    setMappingConfirming(false);
    try {
      if (applied) await onRefresh();
      onNotice(`${applied} mapped ${applied === 1 ? "assignment" : "assignments"} applied${failures.length ? `; ${failures.length} failed (${failures[0]})` : ""}.`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "Assignments were applied, but the saved workspace could not be refreshed.");
    } finally {
      setApplying(false);
    }
  }

  if (organizerTab === "mappings") return <div className="page-content organizer-page">
    <div className="page-intro">
      <div><span className="eyebrow">People API organization</span><h1>Role & entity mappings</h1><p>Assign each exact People API role or entity to one or several manual groups. Role and entity destinations are combined for each person.</p></div>
      <div className="page-actions"><button className="button button--secondary" onClick={() => setOrganizerTab("assignments")}>Member assignments</button><button className="button button--secondary" disabled={!mappingsDirty || mappingSaving} onClick={() => saveMappings()}>{mappingSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save mappings</button><button className="button button--primary" disabled={!mappedAssignments.length || mappingSaving || applying} onClick={reviewMappedAssignments}><Check size={16} />Review {mappedAssignments.length} additions</button></div>
    </div>
    <div className="organizer-mode-note"><SlidersHorizontal size={16} /><span><strong>Multiple groups supported</strong><small>Mappings persist locally. Saving them does not change OpenAI; applying the generated additions requires confirmation.</small></span></div>
    {!mappingsLoaded ? <div className="analytics-loading"><LoaderCircle className="spin" size={22} />Loading mappings</div> : <>
      <section className="organizer-mapping-grid">
        <article className="panel mapping-panel mapping-panel--roles">
          <div className="organizer-table-heading"><span><Group size={15} /><strong>People API role → groups</strong></span><button className="text-button" onClick={useRoleRecommendations}>Add agreed recommendations</button></div>
          <p className="table-note">Mappings use exact People API role titles. Select every destination group that should apply.</p>
          <div className="mapping-filters"><label className="organizer-search"><span>Find role</span><div><Search size={14} /><input value={mappingQuery} onChange={(event) => setMappingQuery(event.target.value)} placeholder="Search exact role" /></div></label><label><span>Mapping status</span><select value={mappingFilter} onChange={(event) => setMappingFilter(event.target.value as typeof mappingFilter)}><option value="all">All roles</option><option value="unmapped">Without group</option><option value="single">One group</option><option value="multiple">More than one group</option></select></label><span>{filteredRoleMappingRows.length} of {roleMappingRows.length} roles</span></div>
          <div className="table-scroll mapping-table-scroll"><table><thead><tr><th>Exact People API role</th><th>People</th><th>Recommendation</th><th>Destination groups</th></tr></thead><tbody>{filteredRoleMappingRows.map((row) => <tr key={row.title}><td><span><strong>{row.title}</strong></span></td><td>{row.members}</td><td>{row.recommendation ? <span className="pill pill--green">{row.recommendation}</span> : <span className="pill pill--neutral">No recommendation</span>}</td><td><GroupMultiSelect groups={writableGroups} selected={mappings.roleToGroups[row.title] ?? []} onToggle={(groupId) => updateRoleMapping(row.title, groupId)} label={`Destination groups for ${row.title}`} /></td></tr>)}</tbody></table></div>
          {!filteredRoleMappingRows.length && <div className="empty-state"><Search size={22} /><strong>No role mappings match</strong><p>Change the search or mapping status filter.</p></div>}
        </article>
        <article className="panel mapping-panel">
          <div className="organizer-table-heading"><span><Building2 size={15} /><strong>Entity → groups</strong></span></div>
          <p className="table-note">Entity rules apply only to matched People API profiles and can coexist with role mappings.</p>
          <div className="entity-mapping-list">{(["Allegro", "eBilet", "Ceneo", "Unknown"] as Entity[]).map((entityName) => { const memberCount = data.members.filter((member) => member.peopleMatch === "Matched" && member.entity === entityName).length; return <div className="entity-mapping-row" key={entityName}><span className="entity-pill"><i style={{ background: entityColors[entityName] }} />{entityName}<small>{memberCount} matched people</small></span><GroupMultiSelect groups={writableGroups} selected={mappings.entityToGroups[entityName] ?? []} onToggle={(groupId) => updateEntityMapping(entityName, groupId)} label={`Destination groups for ${entityName}`} /></div>; })}</div>
          <div className="mapping-plan-summary"><span><strong>{mappedAssignments.length}</strong><small>new group additions</small></span><span><strong>{mappedPeopleCount}</strong><small>unique people</small></span><span><strong>{mappedDistribution.size}</strong><small>destination groups</small></span></div>
          <div className="read-only-note"><ShieldCheck size={17} /><span><strong>{data.members.filter((member) => member.peopleMatch !== "Matched").length} profiles excluded</strong><small>Missing or ambiguous People API profiles are never assigned by saved mappings.</small></span></div>
        </article>
      </section>
      <section className="organizer-action-bar"><span><strong>{mappedAssignments.length} mapped additions ready</strong><small>{mappingsDirty ? "Save or review to persist the changed mappings" : "Mappings are saved locally"}</small></span><button className="button button--secondary" disabled={!mappingsDirty || mappingSaving} onClick={() => saveMappings()}>{mappingSaving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}Save</button><button className="button button--primary" disabled={!mappedAssignments.length || mappingSaving || applying} onClick={reviewMappedAssignments}><Check size={15} />Review additions</button></section>
    </>}
    {mappingConfirming && <div className="confirm-layer"><div className="confirm-card organizer-confirm"><button className="organizer-confirm-close" onClick={() => setMappingConfirming(false)} disabled={applying} aria-label="Close confirmation"><X size={16} /></button><span className="eyebrow">Confirm mapped workspace changes</span><h3>Apply {mappedAssignments.length} group additions?</h3><p>This uses the saved role and entity mappings. It adds memberships only, merges duplicate role/entity destinations, and does not touch SCIM groups.</p><div className="organizer-confirm-summary">{[...mappedDistribution].map(([name, count]) => <span key={name}><strong>{name}</strong><small>{count} {count === 1 ? "addition" : "additions"}</small></span>)}</div>{applying && <div className="organizer-progress"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /><small>{progress.done} of {progress.total}</small></div>}<div className="organizer-confirm-actions"><button className="button button--secondary" onClick={() => setMappingConfirming(false)} disabled={applying}>Cancel</button><button className="button button--primary" onClick={applyMappedAssignments} disabled={applying}>{applying ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{applying ? "Applying" : "Apply additions"}</button></div></div></div>}
  </div>;

  return <div className="page-content organizer-page">
    <div className="page-intro"><div><span className="eyebrow">People API organization</span><h1>Organize members</h1><p>Build reviewed group additions from People API roles and entities. Role rules never remove memberships, and missing profiles stay in review.</p></div><div className="page-actions"><button className="button button--secondary" onClick={() => setOrganizerTab("mappings")}><SlidersHorizontal size={16} />Role & entity mappings</button><button className="button button--primary" disabled={!selectedRows.length || applying} onClick={() => setConfirming(true)}><Check size={16} />Review {selectedRows.length} changes</button></div></div>

    <section className="organizer-summary-grid" aria-label="Role-rule assignment summary">
      {ruleCounts.map(({ target, count }) => <button key={target} className={mode === "rules" && ruleTarget === target ? "active" : ""} onClick={() => { setMode("rules"); setRuleTarget(target); setStatus("all"); setSelected(new Set()); }}><span className="organizer-summary-icon"><Group size={16} /></span><span><strong>{count}</strong><small>ready for {target}</small></span><ChevronRight size={15} /></button>)}
      <button className={mode === "rules" && ruleTarget === "Review" ? "active organizer-review-card" : "organizer-review-card"} onClick={() => { setMode("rules"); setRuleTarget("Review"); setStatus("review"); setSelected(new Set()); }}><span className="organizer-summary-icon"><ShieldCheck size={16} /></span><span><strong>{reviewCount}</strong><small>need a decision</small></span><ChevronRight size={15} /></button>
    </section>

    <section className="panel organizer-controls">
      <label className="organizer-search"><span>Search</span><div><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setSelected(new Set()); }} placeholder="Person, role, department or group" /></div></label>
      <label><span>People API role</span><select value={role} onChange={(event) => { setRole(event.target.value); setSelected(new Set()); }}><option>All</option><option>Missing or ambiguous</option>{roles.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Entity</span><select value={entity} onChange={(event) => { setEntity(event.target.value as EntityFilter); setSelected(new Set()); }}>{entities.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Assignment</span><select value={mode} onChange={(event) => { setMode(event.target.value as AssignmentMode); setRuleTarget("All"); setSelected(new Set()); }}><option value="rules">Use agreed role rules</option>{writableGroups.map((group) => <option value={`group:${group.id}`} key={group.id}>Choose {group.name}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setSelected(new Set()); }}><option value="all">All statuses</option><option value="ready">Ready</option><option value="review">Needs review</option><option value="assigned">Already assigned</option></select></label>
    </section>

    <div className="organizer-mode-note"><SlidersHorizontal size={16} /><span><strong>{mode === "rules" ? "Role-rule mode" : "Manual destination mode"}</strong><small>{mode === "rules" ? "Suggested destinations follow the agreed PM, Developers, white-collar, and SEC rules." : "Your selected manual group is used for matched People API profiles in the filtered list."}</small></span></div>

    <section className="panel organizer-table"><div className="organizer-table-heading"><span><GitCompareArrows size={15} /><strong>{rows.length} people in this view</strong></span><button className="text-button" onClick={toggleAllVisible} disabled={!readyRows.length}>{readyRows.length > 0 && readyRows.every((row) => selected.has(row.member.id)) ? "Clear visible" : `Select ${readyRows.length} ready`}</button></div><div className="table-scroll"><table><thead><tr><th>Person</th><th>People API role</th><th>Entity</th><th>Current groups</th><th>Destination</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.member.id} className={selected.has(row.member.id) ? "selected" : ""}><td><input type="checkbox" aria-label={`Select ${row.member.name}`} checked={selected.has(row.member.id)} disabled={row.status !== "ready" || applying} onChange={() => toggle(row.member.id)} /><button className="organizer-person" onClick={() => onSelectMember(row.member)}><span className="avatar">{initials(row.member.name)}</span><span><strong>{row.member.name}</strong><small>{row.member.email}</small></span></button></td><td>{row.member.peopleRole ? <span className="role-cell"><strong>{row.member.peopleRole}</strong><small>{row.member.department || "—"}</small></span> : <span className="pill pill--warning">Profile missing</span>}</td><td><span className="entity-pill"><i style={{ background: entityColors[row.member.entity] }} />{row.member.entity}</span></td><td><div className="group-tags">{row.member.groups.slice(0, 2).map((group) => <span key={group}>{group}</span>)}{row.member.groups.length > 2 && <span>+{row.member.groups.length - 2}</span>}{row.member.groups.length === 0 && <small>Unassigned</small>}</div></td><td><span className="organizer-destination"><strong>{row.target?.name ?? row.suggestedTarget ?? "Decision needed"}</strong><small>{row.reason}</small></span></td><td>{statusPill(row)}</td></tr>)}</tbody></table></div>{rows.length === 0 && <div className="empty-state"><Building2 size={22} /><strong>No people match these filters</strong><p>Change the role, entity, status, or search selection.</p></div>}</section>

    <section className="organizer-action-bar"><span><strong>{selectedRows.length} selected</strong><small>{selectedRows.length ? `${distribution.size} destination ${distribution.size === 1 ? "group" : "groups"}` : "Select ready rows to create an assignment plan"}</small></span><button className="button button--secondary" disabled={!selected.size || applying} onClick={() => setSelected(new Set())}>Clear</button><button className="button button--primary" disabled={!selectedRows.length || applying} onClick={() => setConfirming(true)}><Check size={15} />Review changes</button></section>

    {confirming && <div className="confirm-layer"><div className="confirm-card organizer-confirm"><button className="organizer-confirm-close" onClick={() => setConfirming(false)} disabled={applying} aria-label="Close confirmation"><X size={16} /></button><span className="eyebrow">Confirm workspace changes</span><h3>Add {selectedRows.length} people to groups?</h3><p>This writes only the reviewed additions below. It does not remove existing memberships or change SCIM-managed groups.</p><div className="organizer-confirm-summary">{[...distribution].map(([name, count]) => <span key={name}><strong>{name}</strong><small>{count} {count === 1 ? "person" : "people"}</small></span>)}</div>{applying && <div className="organizer-progress"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /><small>{progress.done} of {progress.total}</small></div>}<div className="organizer-confirm-actions"><button className="button button--secondary" onClick={() => setConfirming(false)} disabled={applying}>Cancel</button><button className="button button--primary" onClick={applySelected} disabled={applying}>{applying ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{applying ? "Applying" : "Apply additions"}</button></div></div></div>}
  </div>;
}
