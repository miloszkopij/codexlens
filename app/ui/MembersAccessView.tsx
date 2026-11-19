"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, Search, Settings, X } from "lucide-react";
import type { DashboardData, Entity, ExclusiveGroupSet, Member, OrganizerMappings } from "../types";
import { buildMembershipPlan, currentGroupIds, matchesAccessFilter, reviewAccess, type AccessStatus, type MembershipAction, type MembershipChange } from "../../lib/access-review";
import { classifyPeopleRoleFamily, roleFamilies } from "../../lib/role-families";

const emptyMappings: OrganizerMappings = { roleToGroups: {}, entityToGroups: {}, emailDomainToGroups: {} };

export default function MembersAccessView({ data, members, entity, query, onEntityChange, onQueryChange, onRefresh, onNotice, onSelectMember }: {
  data: DashboardData; members: Member[]; entity: Entity | "All"; query: string;
  onEntityChange: (value: Entity | "All") => void; onQueryChange: (value: string) => void;
  onRefresh: () => Promise<void>; onNotice: (message: string) => void; onSelectMember: (member: Member) => void;
}) {
  const [mappings, setMappings] = useState<OrganizerMappings | null>(data.mode === "demo" ? emptyMappings : null);
  const [exclusiveSets, setExclusiveSets] = useState<ExclusiveGroupSet[]>([]);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [count, setCount] = useState("all");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [match, setMatch] = useState<"any" | "all">("any");
  const [status, setStatus] = useState<AccessStatus>("all");
  const [role, setRole] = useState("");
  const [family, setFamily] = useState("");
  const [sort, setSort] = useState("count-desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<MembershipAction>("add");
  const [targetId, setTargetId] = useState("");
  const [plan, setPlan] = useState<MembershipChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ succeeded: number; failures: { name: string; message: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [editingSets, setEditingSets] = useState(false);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const isDemo = data.mode === "demo";

  useEffect(() => {
    let active = true;
    if (isDemo) return;
    Promise.all([fetch("/api/organizer-mappings"), fetch("/api/access-settings")]).then(async ([rulesResponse, setsResponse]) => {
      if (!rulesResponse.ok || !setsResponse.ok) throw new Error("Could not load saved mappings and conflict rules. Retry before reviewing access.");
      const [rules, settings] = await Promise.all([rulesResponse.json() as Promise<OrganizerMappings>, setsResponse.json() as Promise<{ exclusiveGroupSets: ExclusiveGroupSet[] }>]);
      if (active) { setMappings(rules); setExclusiveSets(settings.exclusiveGroupSets); }
    }).catch((reason) => { if (active) setLoadError(reason instanceof Error ? reason.message : "Could not load access rules."); });
    return () => { active = false; };
  }, [isDemo, reload]);

  useEffect(() => {
    if (plan && previewDialog.current && !previewDialog.current.open) previewDialog.current.showModal();
  }, [plan]);

  const reviewed = useMemo(() => members.map((member) => ({ member, review: reviewAccess(member, data.groups, mappings ?? emptyMappings, exclusiveSets) })), [members, data.groups, mappings, exclusiveSets]);
  const visible = reviewed.filter(({ member, review }) =>
    (!role || (role === "__missing__" ? !member.peopleRole : member.peopleRole === role)) &&
    (!family || classifyPeopleRoleFamily(member.peopleRole) === family) &&
    matchesAccessFilter(review, { count, groupIds, match, status }),
  ).sort((a, b) => sort === "name" ? a.member.name.localeCompare(b.member.name) :
    (sort === "count-asc" ? a.review.count - b.review.count : b.review.count - a.review.count) || a.member.name.localeCompare(b.member.name));
  // Hidden rows never participate in bulk edits.
  const selectedMembers = visible.filter(({ member }) => selected.includes(member.id)).map(({ member }) => member);
  const roles = [...new Set(data.members.map((member) => member.peopleRole).filter((value): value is string => Boolean(value)))].sort();
  const groupName = (id: string) => data.groups.find((group) => group.id === id)?.name ?? "Unavailable group";
  const names = (ids: string[]) => ids.length ? ids.map(groupName).join(", ") : "No groups";

  function clearFilters() {
    onQueryChange(""); onEntityChange("All"); setCount("all"); setGroupIds([]); setMatch("any"); setStatus("all"); setRole(""); setFamily(""); setSelected([]);
  }

  function preview() {
    setError(""); setResult(null);
    try {
      const changes = buildMembershipPlan(selectedMembers, data.groups, targetId, action);
      if (!changes.length) { setError("No changes needed: the selected people already have the requested membership state."); return; }
      setPlan(changes);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare changes."); }
  }

  async function applyPlan() {
    if (!plan || busyRef.current || isDemo) return;
    busyRef.current = true; setBusy(true); setProgress(0); setError("");
    const failures: { name: string; message: string }[] = [];
    let succeeded = 0;
    try {
      const response = await fetch("/api/dashboard");
      const fresh = await response.json() as DashboardData;
      if (!response.ok || fresh.mode === "demo" || fresh.workspaceId !== data.workspaceId) throw new Error("Could not verify the workspace snapshot. Refresh and review again.");
      for (const change of plan) {
        const member = fresh.members.find((item) => item.id === change.memberId);
        const target = fresh.groups.find((item) => item.id === change.groupId);
        if (!member || target?.source !== "Manual" || target.name !== change.groupName || JSON.stringify(currentGroupIds(member, fresh.groups)) !== JSON.stringify(change.before)) {
          throw new Error("The directory changed since the preview. No changes were sent. Review the refreshed list.");
        }
      }
      for (const [index, change] of plan.entries()) {
        try {
          const write = await fetch("/api/group-membership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: change.memberId, groupId: change.groupId, action: change.action, expectedPresent: change.action === "remove" }) });
          const payload = await write.json() as { error?: string };
          if (!write.ok) throw new Error(payload.error || "Membership change failed.");
          succeeded++;
        } catch (reason) {
          failures.push({ name: change.name, message: reason instanceof Error ? reason.message : "Request failed; sync to check its outcome." });
          // Stop on the first uncertain write. Never automatically replay a partially applied batch.
          for (const skipped of plan.slice(index + 1)) failures.push({ name: skipped.name, message: "Not attempted: the batch stopped after an error." });
          break;
        } finally { setProgress(index + 1); }
      }
      setResult({ succeeded, failures });
      onNotice(`${succeeded} membership changes verified.${failures.length ? ` ${failures.length} failed or not attempted. Review the Access results.` : ""}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply changes."); }
    finally {
      setPlan(null); setSelected([]);
      try { await onRefresh(); } catch { setError("The list could not be refreshed. Sync before making further changes."); }
      busyRef.current = false; setBusy(false);
    }
  }

  return <div className="access-view">
    <p className="section-helper">Current directory snapshot{data.lastSyncedAt ? ` · last synced ${new Date(data.lastSyncedAt).toLocaleString()}` : ""}. Multiple memberships can be intentional. People API job titles and OpenAI workspace roles are separate fields.</p>
    <div className="access-summary">
      <button onClick={() => setCount("all")}><strong>{members.length}</strong><span>People in search / entity</span></button>
      <button onClick={() => setCount("none")}><strong>{reviewed.filter((row) => row.review.count === 0).length}</strong><span>No groups</span></button>
      <button onClick={() => setCount("multiple")}><strong>{reviewed.filter((row) => row.review.count > 1).length}</strong><span>Multiple groups</span></button>
      <button disabled={!mappings} onClick={() => setStatus("conflict")}><strong>{mappings ? reviewed.filter((row) => row.review.conflicts.length > 0).length : "—"}</strong><span>Exclusive-set conflicts</span></button>
    </div>
    {loadError && <div className="access-feedback" role="alert">{loadError} <button className="text-button" onClick={() => { setLoadError(""); setMappings(null); setReload((value) => value + 1); }}>Retry</button></div>}
    <fieldset className="access-controls panel" disabled={busy}>
      <legend className="sr-only">Access filters</legend>
      <label className="search-field"><Search size={16} /><input aria-label="Search access members" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search people, job titles or groups" /></label>
      <label>Entity<select value={entity} onChange={(event) => onEntityChange(event.target.value as Entity | "All")}>{["All", "Allegro", "eBilet", "Ceneo", "Unknown"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Group count<select value={count} onChange={(event) => setCount(event.target.value)}><option value="all">Any count</option><option value="none">No groups</option><option value="one">Exactly one group</option><option value="multiple">More than one group</option></select></label>
      <label>People API job title<select value={role} onChange={(event) => setRole(event.target.value)}><option value="">All job titles</option><option value="__missing__">Missing job title</option>{roles.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Job family<select value={family} onChange={(event) => setFamily(event.target.value)}><option value="">All families</option>{roleFamilies.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Rule comparison<select disabled={!mappings} value={status} onChange={(event) => setStatus(event.target.value as AccessStatus)}><option value="all">All statuses</option><option value="missing">Missing expected groups</option><option value="extra">Outside saved mappings</option><option value="matches">Matches saved mappings</option><option value="unmapped">No applicable mappings</option><option value="unresolved">Missing / ambiguous profile or group</option><option value="conflict">Exclusive-set conflicts</option></select></label>
      <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="count-desc">Most groups first</option><option value="count-asc">Fewest groups first</option><option value="name">Name A–Z</option></select></label>
      <div className="access-filter-actions"><button className="text-button" onClick={clearFilters}>Reset filters</button><button className="button button--secondary" disabled={!mappings || isDemo} onClick={() => setEditingSets(true)}><Settings size={14} />Conflict rules</button></div>
      <div className="access-group-filter"><div><strong>Current groups</strong><label>Match<select aria-label="Group matching mode" value={match} onChange={(event) => setMatch(event.target.value as "any" | "all")}><option value="any">Any selected group</option><option value="all">All selected groups</option></select></label><small>No selection = all groups</small></div><div className="access-group-options">{data.groups.map((group) => <label key={group.id}><input type="checkbox" checked={groupIds.includes(group.id)} onChange={() => setGroupIds((ids) => ids.includes(group.id) ? ids.filter((id) => id !== group.id) : [...ids, group.id])} />{group.name}{group.source === "SCIM" && <small>SCIM</small>}</label>)}</div></div>
    </fieldset>
    <p className="section-helper">Saved role, entity and email-domain mappings are additive. “Outside saved mappings” means review, not unauthorized access; SCIM groups are excluded from that comparison. No memberships are removed automatically.</p>
    <section className="panel">
      <div className="panel-heading"><h2>Access review <small>{visible.length} of {data.members.length} people</small></h2><span>{selectedMembers.length} selected in this view</span></div>
      <div className="table-scroll"><table className="access-table"><thead><tr>
        <th><input type="checkbox" aria-label={`Select all ${visible.length} visible members`} disabled={busy || !visible.length} checked={visible.length > 0 && selectedMembers.length === visible.length} onChange={(event) => setSelected(event.target.checked ? visible.map(({ member }) => member.id) : [])} /></th>
        <th>Person / entity</th><th>Job title / OpenAI role</th><th>All current groups</th><th>Count</th><th>Rule comparison</th>
      </tr></thead><tbody>{visible.map(({ member, review }) => <tr key={member.id} className={selected.includes(member.id) ? "access-selected" : ""}>
        <td><input type="checkbox" aria-label={`Select ${member.name}`} disabled={busy} checked={selected.includes(member.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, member.id] : ids.filter((id) => id !== member.id))} /></td>
        <td><button className="access-person" disabled={busy} onClick={() => onSelectMember(member)}><strong>{member.name}</strong><small>{member.email}</small></button><small>{member.entity}</small></td>
        <td><span>{member.peopleRole ?? "Job title missing"}</span><small>OpenAI: {member.workspaceRole}</small></td>
        <td><div className="group-tags">{review.current.map((id) => <span key={id}>{groupName(id)}{data.groups.find((group) => group.id === id)?.source === "SCIM" ? " · SCIM" : ""}</span>)}{!review.resolved && <small>Unresolved membership — refresh</small>}{review.count === 0 && <small>No groups</small>}</div></td>
        <td><span className={`pill ${review.count > 1 ? "pill--green" : "pill--neutral"}`}>{review.count}</span></td>
        <td className="access-rule-cell">{!mappings ? <small>{loadError ? "Rules unavailable" : "Loading rules…"}</small> : <>
          {review.conflicts.map((set) => <span key={set.id} className="pill pill--warning">Conflict: {set.name}</span>)}
          {review.missing.length > 0 && <span title={review.missing.map((id) => `${groupName(id)}: ${review.expected.get(id)?.join(" + ")}`).join("\n")}>Missing: <strong>{names(review.missing)}</strong></span>}
          {review.extra.length > 0 && <span>Outside mappings: <strong>{names(review.extra)}</strong></span>}
          {review.matches && <span className="pill pill--green">Matches mappings</span>}
          {review.unmapped && <small>No applicable mappings</small>}
          {review.unresolved && <small>{member.peopleMatch !== "Matched" ? `${member.peopleMatch} People API profile — not evaluated` : "Membership needs a refresh"}</small>}
        </>}</td>
      </tr>)}</tbody></table></div>
      {!visible.length && <div className="empty-state"><Search size={22} /><strong>No matching people</strong><p>Try clearing a filter or selecting fewer groups.</p></div>}
    </section>
    {(selectedMembers.length > 0 || busy) && <div className="access-bulk panel">
      <div><strong>{selectedMembers.length} people selected</strong><small>Only visible selected people are included. Existing unrelated memberships stay unchanged.</small></div>
      <label>Action<select disabled={busy || isDemo} value={action} onChange={(event) => setAction(event.target.value as MembershipAction)}><option value="add">Add to group</option><option value="remove">Remove from group</option></select></label>
      <label>Target group<select disabled={busy || isDemo} value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose manual group</option>{data.groups.filter((group) => group.source === "Manual").map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <button className="button button--primary" disabled={!selectedMembers.length || !targetId || busy || isDemo || !mappings} onClick={preview}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Review changes</button>
    </div>}
    {isDemo && <p className="section-helper">Demo is read-only. No real workspace memberships or conflict rules can be changed here.</p>}
    {error && <div className="access-feedback" role="alert">{error}</div>}
    {result && <div className="access-feedback" role="status"><strong>{result.succeeded} changes verified{result.failures.length ? ` · ${result.failures.length} failed or not attempted` : ""}</strong>{result.failures.length > 0 && <><p>Sync before retrying: an unverified request may already have changed OpenAI. Successful changes will not be replayed automatically.</p><ul>{result.failures.map((failure, index) => <li key={index}>{failure.name}: {failure.message}</li>)}</ul></>}</div>}
    {plan && <dialog className="access-dialog" ref={previewDialog} aria-labelledby="access-preview-title" onCancel={(event) => { if (busy) event.preventDefault(); else setPlan(null); }}>
      <h2 id="access-preview-title">Review {plan.length} membership {plan.length === 1 ? "change" : "changes"}</h2>
      <p>{plan[0].action === "add" ? "Add to" : "Remove from"} <strong>{plan[0].groupName}</strong>. This changes the real OpenAI workspace. {selectedMembers.length - plan.length} already-correct people skipped.</p>
      <p className="section-helper">Before/after uses the latest local snapshot. Each target membership is checked in OpenAI before writing and verified afterward. A batch is not atomic; it stops on the first error.</p>
      <div className="table-scroll"><table><thead><tr><th>Person</th><th>Before</th><th>After</th></tr></thead><tbody>{plan.map((change) => <tr key={change.memberId}><td><span><strong>{change.name}</strong><small>{change.email}</small></span></td><td>{names(change.before)}</td><td>{names(change.after)}{exclusiveSets.filter((set) => set.groupIds.filter((id) => change.after.includes(id)).length > 1).map((set) => <small className="access-warning" key={set.id}>Conflict: {set.name}</small>)}</td></tr>)}</tbody></table></div>
      <div className="access-dialog-actions"><button className="button button--secondary" disabled={busy} onClick={() => setPlan(null)}>Cancel</button><button className="button button--primary" disabled={busy} onClick={applyPlan}>{busy ? <><LoaderCircle size={15} className="spin" />Verifying {progress} / {plan.length}</> : `Confirm ${plan.length} ${plan.length === 1 ? "change" : "changes"}`}</button></div>
    </dialog>}
    {editingSets && <ConflictRules data={data} initial={exclusiveSets} onClose={() => setEditingSets(false)} onSaved={(sets) => { setExclusiveSets(sets); setEditingSets(false); }} />}
  </div>;
}

function ConflictRules({ data, initial, onClose, onSaved }: { data: DashboardData; initial: ExclusiveGroupSet[]; onClose: () => void; onSaved: (sets: ExclusiveGroupSet[]) => void }) {
  const [sets, setSets] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function save() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/access-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exclusiveGroupSets: sets }) });
      const payload = await response.json() as { error?: string; exclusiveGroupSets: ExclusiveGroupSet[] };
      if (!response.ok) throw new Error(payload.error || "Could not save rules.");
      onSaved(payload.exclusiveGroupSets);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save rules."); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="access-dialog" aria-labelledby="exclusive-title" onCancel={(event) => { if (saving) event.preventDefault(); else onClose(); }}>
    <h2 id="exclusive-title"><AlertTriangle size={19} /> Mutually exclusive groups</h2>
    <p>Flag people who belong to more than one group in a set. For example, an entity set could contain Ceneo and eBilet; Developers + eBilet would still be valid. These local review rules never change memberships or OpenAI permissions.</p>
    <fieldset disabled={saving} className="access-set-editor"><legend className="sr-only">Exclusive sets</legend>
      {sets.map((set) => <div className="access-exclusive-set" key={set.id}><div><label>Set name<input maxLength={100} value={set.name} onChange={(event) => setSets((rows) => rows.map((row) => row.id === set.id ? { ...row, name: event.target.value } : row))} /></label><button className="icon-button" aria-label={`Remove set ${set.name || "Untitled"}`} onClick={() => setSets((rows) => rows.filter((row) => row.id !== set.id))}><X size={16} /></button></div><div className="access-group-options">{data.groups.map((group) => <label key={group.id}><input type="checkbox" checked={set.groupIds.includes(group.id)} onChange={() => setSets((rows) => rows.map((row) => row.id === set.id ? { ...row, groupIds: row.groupIds.includes(group.id) ? row.groupIds.filter((id) => id !== group.id) : [...row.groupIds, group.id] } : row))} />{group.name}</label>)}</div>{set.groupIds.filter((id) => !data.groups.some((group) => group.id === id)).map((id) => <button className="text-button" key={id} onClick={() => setSets((rows) => rows.map((row) => row.id === set.id ? { ...row, groupIds: row.groupIds.filter((value) => value !== id) } : row))}>Remove unavailable group</button>)}</div>)}
      {!sets.length && <p>No exclusive sets configured. Multiple group memberships are informational, not conflicts.</p>}
      <button className="button button--secondary" disabled={sets.length >= 50} onClick={() => setSets((rows) => [...rows, { id: crypto.randomUUID(), name: "", groupIds: [] }])}>Add exclusive set</button>
    </fieldset>
    {error && <p role="alert" className="access-feedback">{error}</p>}
    <div className="access-dialog-actions"><button className="button button--secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button button--primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save local rules"}</button></div>
  </dialog>;
}
