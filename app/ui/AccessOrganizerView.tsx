"use client";
import { useEffect, useState } from "react";
import type { DashboardData, Member, OrganizerMappings } from "../types";
import { accessRulesRevision, emailDomain, emptyAccessRules, isSpecialGroup, normalizeDomain, reviewMember, validateAccessRules, type LeaderScope } from "../../lib/access-policy";
import { parseOrganizerDraft } from "../../lib/organizer-draft";
import AccessChangeDialog, { type AccessRequest } from "./AccessChangeDialog";
import JobTitleRules from "./JobTitleRules";
import PersonExceptions from "./PersonExceptions";
import StructureRuleEditor from "./StructureRuleEditor";
import { useStructureContext } from "./useStructureContext";
import { useUnsavedWarning } from "./useUnsavedWarning";

export default function AccessOrganizerView({ data, onSelectMember, onRefresh, onNotice }: { data: DashboardData; onSelectMember: (member: Member) => void; onRefresh: () => Promise<void>; onNotice: (message: string) => void }) {
  const demo = data.mode === "demo";
  const draftStorageKey = `codexlens.organize.draft.v1:${data.workspaceId}`;
  const [rules, setRules] = useState<OrganizerMappings>(emptyAccessRules);
  const [saved, setSaved] = useState<OrganizerMappings | null>(demo ? emptyAccessRules : null);
  const [loaded, setLoaded] = useState(demo);
  const [migrationAck, setMigrationAck] = useState(false);
  const [tab, setTab] = useState<"rules" | "review">("rules");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    fetch("/api/organizer-mappings", { signal: controller.signal }).then(async (response) => { const value = await response.json() as OrganizerMappings & { error?: string }; if (!response.ok) throw new Error(value.error); return value as OrganizerMappings; }).then((value) => {
      if (controller.signal.aborted) return;
      let draft = value;
      try {
        const raw = window.localStorage.getItem(draftStorageKey);
        if (raw) {
          const backup = JSON.parse(raw) as { draft?: unknown; savedRevision?: string };
          if (backup.savedRevision === accessRulesRevision(value)) {
            draft = parseOrganizerDraft(backup);
            setRecoveryMessage("Unsaved Organize draft restored from this browser. Review it before saving.");
          } else setRecoveryMessage("A browser draft from a different saved version exists. It was not applied automatically; restore a downloaded backup only after reviewing current rules.");
        }
      } catch { setRecoveryMessage("Browser draft could not be restored automatically. Use a downloaded backup if available."); }
      setRules(draft); setSaved(value); setLoaded(true);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [demo, draftStorageKey]);
  const structures = useStructureContext(data, saved);
  const targets = data.groups.filter((group) => group.source === "Manual" && !isSpecialGroup(group));
  const migration = saved?.policyVersion !== 2;
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);
  useUnsavedWarning(loaded && !demo && dirty);
  useEffect(() => {
    if (!loaded || demo || !saved || !dirty) return;
    try { window.localStorage.setItem(draftStorageKey, JSON.stringify({ draft: rules, savedRevision: accessRulesRevision(saved), updatedAt: new Date().toISOString() })); }
    catch { /* Download draft remains available when browser storage is blocked. */ }
  }, [loaded, demo, saved, rules, dirty, draftStorageKey]);
  const domains = [...new Set([...data.members.map((member) => emailDomain(member.email)).filter(Boolean), ...Object.keys(rules.emailDomainToGroups)])].sort();
  function changeRule(type: "roleToGroups" | "emailDomainToGroups", key: string, id: string) {
    setRules((current) => { const map = { ...current[type] }; if (id) map[key] = [id]; else delete map[key]; return { ...current, [type]: map }; });
  }
  function selector(type: "roleToGroups" | "emailDomainToGroups", key: string) {
    const ids = rules[type][key] ?? [];
    const invalid = ids.length > 1 || ids.some((id) => !targets.some((group) => group.id === id));
    return <select aria-label={`Destination for ${key}`} disabled={!loaded || saving || demo} value={invalid ? "__review__" : ids[0] ?? ""} onChange={(event) => changeRule(type, key, event.target.value)}><option value="">No rule</option>{invalid && <option value="__review__" disabled>Review legacy targets ({ids.length})</option>}{targets.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>;
  }
  function changeScopedRule(title: string, scope: LeaderScope, groupId: string) {
    const field = scope === "inside" ? "roleToGroupsInLeaderStructure" : "roleToGroupsOutsideLeaderStructure";
    setRules((current) => ({ ...current, [field]: { ...(current[field] ?? {}), [title]: groupId ? [groupId] : [] } }));
  }
  function changeScopedRules(rows: { title: string; scope: LeaderScope }[], groupId: string) {
    setRules((current) => {
      const inside = { ...(current.roleToGroupsInLeaderStructure ?? {}) };
      const outside = { ...(current.roleToGroupsOutsideLeaderStructure ?? {}) };
      for (const { title, scope } of rows) (scope === "inside" ? inside : outside)[title] = groupId ? [groupId] : [];
      return { ...current, roleToGroupsInLeaderStructure: inside, roleToGroupsOutsideLeaderStructure: outside };
    });
  }
  function changePersonException(memberId: string, groupId: string) {
    setRules((current) => {
      const memberOverrides = { ...(current.memberOverrides ?? {}) };
      if (groupId) memberOverrides[memberId] = groupId;
      else delete memberOverrides[memberId];
      return { ...current, memberOverrides };
    });
  }
  function matches(key: string, ids: string[]) {
    const invalid = ids.length > 1 || ids.some((id) => !targets.some((group) => group.id === id));
    return key.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "all" || (filter === "unmapped" && ids.length === 0) || (filter === "mapped" && ids.length === 1 && !invalid) || (filter === "conflict" && invalid));
  }
  async function save() {
    setError(""); setSaving(true);
    try {
      if (migration && !migrationAck) throw new Error("Acknowledge retirement of legacy entity rules first.");
      const validated = validateAccessRules({ ...rules, policyVersion: 2, entityToGroups: {} }, data.groups);
      const response = await fetch("/api/organizer-mappings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...validated, expectedRevision: accessRulesRevision(saved!) }) });
      const value = await response.json() as OrganizerMappings & { error?: string }; if (!response.ok) throw new Error(value.error);
      setRules(value); setSaved(value); setSelected([]); setRecoveryMessage("");
      try { window.localStorage.removeItem(draftStorageKey); } catch { /* A completed server save is authoritative. */ }
      onNotice("Assignment rules saved locally. No OpenAI memberships changed. Review proposed changes next.");
    } catch (reason) { setError(reason instanceof TypeError ? "Cannot reach the local CodexLens server. Keep this tab open, start the app, then retry. Your draft remains here." : (reason as Error).message); }
    finally { setSaving(false); }
  }
  function downloadDraft() {
    const payload = { workspaceId: data.workspaceId, draft: rules, saved, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "codexlens-organize-draft.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function restoreDraft(input: HTMLInputElement) {
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Draft backup is too large.");
      const payload = JSON.parse(await file.text()) as Record<string, unknown>;
      if (payload.workspaceId && payload.workspaceId !== data.workspaceId) throw new Error("This backup belongs to another workspace.");
      const draft = parseOrganizerDraft(payload);
      setRules(draft); setError(""); setRecoveryMessage("Draft restored from backup. Review its assignments, then click Save rules.");
    } catch (reason) { setError((reason as Error).message); }
    finally { input.value = ""; }
  }
  function addDomain() {
    try { const normalized = normalizeDomain(domain); if (!domains.includes(normalized)) setRules((current) => ({ ...current, emailDomainToGroups: { ...current.emailDomainToGroups, [normalized]: [] } })); setDomain(""); setError(""); }
    catch (reason) { setError((reason as Error).message); }
  }
  const reviewed = data.members.map((member) => ({ member, review: reviewMember(member, data.groups, saved ?? emptyAccessRules, structures.members?.[member.id]) }));
  const filteredReview = reviewed.filter(({ member, review }) => `${member.name} ${member.email} ${member.peopleRole ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || (filter === "different" ? review.status === "different" : filter === "aligned" ? review.status === "aligned" : review.status === "blocked" || review.status === "unmapped")));
  const ready = filteredReview.filter((row) => row.review.status === "different");
  const selectedIds = ready.filter((row) => selected.includes(row.member.id)).map((row) => row.member.id);
  const names = (ids: string[]) => ids.map((id) => data.groups.find((group) => group.id === id)?.name ?? "Unavailable").join(", ") || "None";
  return <div className="page-content access-workspace"><div className="page-intro"><div><span className="eyebrow">Assignment policy</span><h1>Organize</h1><p>Assign groups by person exception, email domain, reporting structure, or People API job title. Entity labels do not assign groups.</p></div><button className="button button--primary" disabled={demo || !loaded || saving || (!dirty && !migration)} onClick={save}>{saving ? "Saving…" : "Save rules"}</button></div>
    <div className="policy-explainer panel"><strong>1. Specific person exception</strong><span>otherwise</span><strong>2. Exact email-domain rule</strong><span>otherwise</span><strong>3. Manager’s structure rule</strong><span>otherwise</span><strong>4. People API job-title rule</strong><span>otherwise</span><strong>5. Manual review</strong><p>Automatic rules choose one regular group. Person exceptions can choose any manually managed group, including admin and cat-team; special destinations do not remove regular memberships.</p></div>
    {migration && loaded && <div className="analytics-warning"><strong>Existing rules need review</strong><p>Previous multi-group rules are preserved for inspection but cannot be applied. {Object.keys(rules.entityToGroups).length} legacy entity rules will be retired when you save. Replace them with exact email-domain rules; no memberships change on save.</p>{Object.entries(rules.entityToGroups).map(([entity, ids]) => <small key={entity}>{entity}: {names(ids ?? [])}<br /></small>)}<label><input type="checkbox" checked={migrationAck} onChange={(event) => setMigrationAck(event.target.checked)} />I reviewed legacy targets and will use email-domain rules instead of entity assignments.</label></div>}
    {error && !dirty && <p className="access-feedback" role="alert">{error}</p>}
    {loaded && !demo && <div className="policy-draft-tools panel"><span>{recoveryMessage || (dirty ? "Unsaved changes stay in this tab. Download a backup before reloading." : "No unsaved rule changes.")}</span><button className="button button--secondary" onClick={downloadDraft}>Download draft backup</button><label>Restore draft backup<input type="file" accept=".json,application/json" aria-label="Restore Organize draft backup" onChange={(event) => void restoreDraft(event.currentTarget)} /></label></div>}
    {loaded && !demo && <div className="panel structure-context-status"><span>{structures.loading ? "Loading People API reporting structures…" : structures.error || (structures.retrievedAt ? `${structures.leaderName} structure checked ${new Date(structures.retrievedAt).toLocaleString()}. Refreshed again for preview and confirmation.` : "Structure review unavailable.")}</span><button className="button button--secondary" disabled={structures.loading} onClick={structures.refresh}>Refresh structures</button></div>}
    <div className="segmented-filter"><button aria-pressed={tab === "rules"} onClick={() => { setTab("rules"); setFilter("all"); setQuery(""); }}>Assignment rules</button><button aria-pressed={tab === "review"} onClick={() => { setTab("review"); setFilter("different"); setQuery(""); }}>Review people</button></div>
    <div className="policy-filters panel"><label>Search<input placeholder={tab === "rules" ? "Job title, email domain or manager" : "Name, email or job title"} value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]); }} /></label><label>Show<select value={filter} onChange={(event) => { setFilter(event.target.value); setSelected([]); }}><option value="all">All</option>{tab === "rules" ? <><option value="unmapped">Without a group</option><option value="mapped">Mapped</option><option value="conflict">Conflicting / invalid targets</option></> : <><option value="different">Changes needed</option><option value="aligned">Already aligned</option><option value="blocked">Needs a decision / blocked</option></>}</select></label>{dirty && <span className="pill pill--warning">Unsaved rules — review uses last saved version</span>}</div>
    {tab === "rules" ? <><PersonExceptions members={data.members} groups={data.groups} overrides={rules.memberOverrides ?? {}} disabled={!loaded || saving || demo} query={query} onChange={changePersonException} /><div className="policy-rules-grid"><div className="policy-rule-stack"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">Priority 2</span><h2>Email domain → regular group</h2></div></div><p className="table-note">Uses the workspace member’s email. Exact, case-insensitive domain only: ceneo.pl does not match sub.ceneo.pl or notceneo.pl. Add each intended domain explicitly.</p><div className="policy-bulk"><input aria-label="New email domain" placeholder="e.g. ceneo.pl" value={domain} onChange={(event) => setDomain(event.target.value)} /><button className="button button--secondary" disabled={demo || !domain.trim() || !loaded} onClick={addDomain}>Add domain</button></div><div className="table-scroll"><table className="policy-table"><thead><tr><th>Email domain</th><th>People</th><th>Destination</th></tr></thead><tbody>{domains.filter((key) => matches(key, rules.emailDomainToGroups[key] ?? [])).map((key) => <tr key={key}><td><strong>@{key}</strong><small>{[...new Set(data.members.filter((m) => emailDomain(m.email) === key).map((m) => m.entity))].join(", ")}</small></td><td>{data.members.filter((m) => emailDomain(m.email) === key).length}</td><td>{selector("emailDomainToGroups", key)}</td></tr>)}</tbody></table></div></section>
      <StructureRuleEditor rules={rules.structureRules ?? []} groups={data.groups} contexts={structures.members} query={query} filter={filter} disabled={!loaded || saving} demo={demo} onChange={(structureRules) => setRules((current) => ({ ...current, structureRules }))} />
      </div><JobTitleRules data={data} rules={rules} targets={targets} structures={structures} query={query} statusFilter={filter} disabled={!loaded || saving || demo} onRuleChange={changeScopedRule} onBulkRuleChange={changeScopedRules} onSelectMember={onSelectMember} /></div></> : <>
      <div className="policy-bulk panel"><strong>{selectedIds.length} selected · {ready.length} ready in this view</strong><button className="button button--primary" disabled={demo || dirty || !loaded || migration || !selectedIds.length} onClick={() => setRequest({ memberIds: selectedIds, operation: { kind: "rules" } })}>Preview {selectedIds.length} changes</button><small>Save rules first. {Math.ceil(selectedIds.length / 100)} review {Math.ceil(selectedIds.length / 100) === 1 ? "batch" : "batches"} of up to 100; confirm each separately. Nothing is applied automatically.</small></div>
      <section className="panel table-scroll"><table className="policy-table"><thead><tr><th><input type="checkbox" aria-label="Select ready people" checked={ready.length > 0 && selectedIds.length === ready.length} onChange={(event) => setSelected(event.target.checked ? ready.map((r) => r.member.id) : [])} /></th><th>Person</th><th>Current regular</th><th>Expected regular</th><th>Keep special</th><th>Reason</th></tr></thead><tbody>{filteredReview.map(({ member, review }) => <tr key={member.id}><td><input type="checkbox" aria-label={`Select ${member.name}`} disabled={review.status !== "different"} checked={selectedIds.includes(member.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} /></td><td><button className="text-button" onClick={() => onSelectMember(member)}>{member.name}</button><small>{member.email}</small></td><td>{names(review.regular)}</td><td>{review.expected ? names([review.expected]) : "Review needed"}</td><td>{names(review.special)}</td><td><span className="pill pill--neutral">{review.status}</span><small>{review.problem || review.reason}</small></td></tr>)}</tbody></table>{!filteredReview.length && <div className="empty-state">No people match this review.</div>}</section>
    </>}
    {request && <AccessChangeDialog request={request} groups={data.groups} onClose={(completed) => { setRequest(null); if (completed) setSelected([]); }} onDone={onRefresh} />}
    {loaded && !demo && dirty && <div className="draft-save-bar panel" role="status"><div><strong>Unsaved assignment rules</strong><small>Keep this page open or download a backup. Saving does not change OpenAI memberships.</small>{error && <small className="draft-save-error" role="alert">{error}</small>}</div><button className="button button--secondary" disabled={saving} onClick={() => { if (saved) setRules(saved); try { window.localStorage.removeItem(draftStorageKey); } catch { /* Best effort. */ } setError(""); setSelected([]); }}>Discard draft</button><button className="button button--primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save rules"}</button></div>}
  </div>;
}
