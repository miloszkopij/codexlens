"use client";
import { useEffect, useMemo, useState } from "react";
import type { DashboardData, Entity, Member, OrganizerMappings } from "../types";
import { emptyAccessRules, isSpecialGroup, memberGroupStatus, memberGroupStatusLabels, reviewMember } from "../../lib/access-policy";
import AccessChangeDialog, { type AccessRequest } from "./AccessChangeDialog";
import { useStructureContext } from "./useStructureContext";

export default function MembersWorkspaceView({ data, members, entity, query, onEntityChange, onQueryChange, onSelectMember, onRefresh }: {
  data: DashboardData; members: Member[]; entity: Entity | "All"; query: string; onEntityChange: (value: Entity | "All") => void;
  onQueryChange: (value: string) => void; onSelectMember: (member: Member) => void; onRefresh: () => Promise<void>;
}) {
  const [view, setView] = useState<"people" | "groups">("people");
  const [rules, setRules] = useState<OrganizerMappings | null>(data.mode === "demo" ? emptyAccessRules : null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | keyof typeof memberGroupStatusLabels>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [creating, setCreating] = useState(false);
  const demo = data.mode === "demo";
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    fetch("/api/organizer-mappings", { signal: controller.signal }).then(async (response) => { const value = await response.json() as OrganizerMappings & { error?: string }; if (!response.ok) throw new Error(value.error); return value; }).then(setRules).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [demo, data.lastSyncedAt]);
  const structures = useStructureContext(data, rules);
  const rows = useMemo(() => members.map((member) => ({ member, review: reviewMember(member, data.groups, rules ?? emptyAccessRules, structures.members?.[member.id]) })), [members, data.groups, rules, structures.members]);
  const presets = [
    { id: "all", label: "All people", matches: () => true },
    { id: "none", label: "No groups", matches: (r: typeof rows[number]) => !r.review.current.length },
    { id: "special", label: "Special groups only", matches: (r: typeof rows[number]) => !r.review.regular.length && r.review.special.length > 0 },
    { id: "one", label: "One regular group", matches: (r: typeof rows[number]) => r.review.regular.length === 1 },
    { id: "conflict", label: "Multiple regular groups", matches: (r: typeof rows[number]) => r.review.conflict },
    { id: "different", label: "Different from rules", matches: (r: typeof rows[number]) => r.review.status === "different" },
    { id: "profile", label: "Profile needs review", matches: (r: typeof rows[number]) => r.member.peopleMatch !== "Matched" },
  ];
  const visible = rows.filter((row) => (presets.find((preset) => preset.id === filter)?.matches(row) ?? true) && (!groupFilter || row.review.current.includes(groupFilter)) && (!roleFilter || row.member.peopleRole === roleFilter) && (!statusFilter || memberGroupStatus(row.review) === statusFilter));
  const selectedIds = visible.filter((row) => selected.includes(row.member.id)).map((row) => row.member.id);
  const names = (ids: string[]) => ids.map((id) => data.groups.find((group) => group.id === id)?.name ?? "Unavailable").join(", ") || "—";
  async function createGroup() {
    if (!newGroup.trim() || creating || demo) return;
    setCreating(true); setError("");
    try {
      const response = await fetch("/api/workspace-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newGroup }) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error);
      setNewGroup(""); await onRefresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setCreating(false); }
  }
  return <div className="page-content access-workspace"><div className="page-intro"><div><span className="eyebrow">Access management</span><h1>Members & groups</h1><p>One regular group per person. admin and cat-team are special, individually assigned memberships.</p></div><a className="button button--secondary" href="/api/export">Export</a></div>
    <div className="segmented-filter" aria-label="Members views"><button aria-pressed={view === "people"} onClick={() => setView("people")}>People</button><button aria-pressed={view === "groups"} onClick={() => setView("groups")}>Groups</button></div>
    {error && <p className="access-feedback" role="alert">{error}</p>}
    {view === "people" ? <>
      <div className="access-summary access-summary--compact">{presets.map((preset) => <button key={preset.id} aria-pressed={filter === preset.id} onClick={() => { setFilter(preset.id); setSelected([]); }}><strong>{preset.id === "different" && !rules ? "—" : rows.filter(preset.matches).length}</strong><span>{preset.label}</span></button>)}</div>
      <div className="policy-filters panel"><label>Search<input placeholder="Name, email, job title or group" value={query} onChange={(event) => { onQueryChange(event.target.value); setSelected([]); }} /></label><label>Entity<select value={entity} onChange={(event) => { onEntityChange(event.target.value as Entity | "All"); setSelected([]); }}>{["All", "Allegro", "eBilet", "Ceneo", "Unknown"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Current group<select value={groupFilter} onChange={(event) => { setGroupFilter(event.target.value); setSelected([]); }}><option value="">All groups</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}{isSpecialGroup(group) ? " · special" : ""}</option>)}</select></label><label>Status<select aria-label="Membership status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setSelected([]); }}><option value="">All statuses</option>{Object.entries(memberGroupStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>People API job title<select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setSelected([]); }}><option value="">All titles</option>{[...new Set(data.members.map((m) => m.peopleRole).filter(Boolean))].sort().map((title) => <option key={title} value={title!}>{title}</option>)}</select></label><button className="button button--secondary" onClick={() => { setFilter("all"); setGroupFilter(""); setRoleFilter(""); setStatusFilter(""); onEntityChange("All"); onQueryChange(""); setSelected([]); }}>Clear filters</button></div>
      {selectedIds.length > 0 && <div className="policy-bulk panel"><strong>{selectedIds.length} selected</strong><select aria-label="Bulk destination" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Choose regular group</option>{data.groups.filter((g) => g.source === "Manual" && !isSpecialGroup(g)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><button className="button button--secondary" disabled={demo || !target} onClick={() => setRequest({ memberIds: selectedIds, operation: { kind: "move", groupId: target } })}>Review move</button><button className="button button--primary" disabled={demo || !rules} onClick={() => setRequest({ memberIds: selectedIds, operation: { kind: "rules" } })}>Review rule-based changes</button><small>{Math.ceil(selectedIds.length / 100)} review {Math.ceil(selectedIds.length / 100) === 1 ? "batch" : "batches"} of up to 100 people. Confirm each batch separately. Special groups are edited per person.</small></div>}
      <section className="panel"><div className="panel-heading"><h2>People</h2><small>{visible.length} matching · {data.lastSyncedAt ? `Snapshot ${new Date(data.lastSyncedAt).toLocaleString()}` : "Demo preview"}</small></div><div className="table-scroll"><table className="policy-table"><thead><tr><th><input type="checkbox" aria-label="Select visible people" checked={visible.length > 0 && selectedIds.length === visible.length} onChange={(event) => setSelected(event.target.checked ? visible.map((r) => r.member.id) : [])} /></th><th>Person / entity</th><th>People API job title</th><th>Regular groups</th><th>Special groups</th><th>Status</th><th /></tr></thead><tbody>{visible.map(({ member, review }) => <tr key={member.id}><td><input type="checkbox" aria-label={`Select ${member.name}`} checked={selectedIds.includes(member.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} /></td><td><button className="text-button" onClick={() => onSelectMember(member)}>{member.name}</button><small>{member.email}</small><small>{member.entity}</small></td><td>{member.peopleRole || "Missing"}<small>{member.peopleMatch}</small></td><td>{names(review.regular)}</td><td>{names(review.special)}</td><td><span className={`pill ${review.conflict || !review.regular.length ? "pill--warning" : "pill--green"}`}>{memberGroupStatusLabels[memberGroupStatus(review)]}</span><small>{!rules ? "Loading rules…" : review.problem || (review.status === "different" ? `Expected: ${names([review.expected!])}` : review.status === "aligned" ? "Matches rules" : "No applicable rule")}</small></td><td><button className="button button--secondary" onClick={() => onSelectMember(member)}>Manage</button></td></tr>)}</tbody></table></div>{!visible.length && <div className="empty-state">No people match these filters.</div>}</section>
    </> : <>
      <div className="policy-bulk panel"><label>New group name<input placeholder="Group name" value={newGroup} onChange={(event) => setNewGroup(event.target.value)} maxLength={100} /></label><button className="button button--primary" disabled={demo || !newGroup.trim() || creating} onClick={createGroup}>{creating ? "Creating…" : "Create group in OpenAI"}</button><small>Creates an empty group. No memberships or permissions are assigned.</small></div>
      <section className="panel table-scroll"><table className="policy-table"><thead><tr><th>Group</th><th>Type</th><th>Source</th><th>Members</th><th>Regular-group conflicts</th><th /></tr></thead><tbody>{data.groups.map((group) => { const groupRows = data.members.map((member) => ({ member, review: reviewMember(member, data.groups, rules ?? emptyAccessRules) })).filter((row) => row.review.current.includes(group.id)); return <tr key={group.id}><td><strong>{group.name}</strong></td><td>{isSpecialGroup(group) ? "Special · manual per person" : "Regular"}</td><td>{group.source === "SCIM" ? "Externally managed · read-only" : "Manual"}</td><td>{groupRows.length}</td><td>{groupRows.filter((row) => row.review.conflict).length}</td><td><button className="button button--secondary" onClick={() => { setGroupFilter(group.id); setFilter("all"); setRoleFilter(""); setStatusFilter(""); onEntityChange("All"); onQueryChange(""); setSelected([]); setView("people"); }}>Manage members</button></td></tr>; })}</tbody></table></section><p className="section-helper">Rename, deletion and permission definitions remain in <a href="https://admin.openai.com/" target="_blank" rel="noreferrer">OpenAI Admin</a>. CodexLens never deletes special groups.</p>
    </>}
    {request && <AccessChangeDialog request={request} groups={data.groups} onClose={(completed) => { setRequest(null); if (completed) setSelected([]); }} onDone={onRefresh} />}
  </div>;
}
