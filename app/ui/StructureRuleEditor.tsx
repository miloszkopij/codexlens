"use client";
import { useEffect, useRef, useState } from "react";
import type { ManagementManagerOption, MemberStructureContext, StructureGroupRule, WorkspaceGroup } from "../types";
import { demoManagementManagers } from "../demo-data";
import { isSpecialGroup } from "../../lib/access-policy";

export default function StructureRuleEditor({ rules, groups, contexts, query, filter, disabled, demo, onChange }: {
  rules: StructureGroupRule[]; groups: WorkspaceGroup[]; contexts?: Record<string, MemberStructureContext>;
  query: string; filter: string; disabled: boolean; demo: boolean; onChange: (rules: StructureGroupRule[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ManagementManagerOption[]>([]);
  const [manager, setManager] = useState<ManagementManagerOption | null>(null);
  const [destination, setDestination] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const targets = groups.filter((group) => group.source === "Manual" && !isSpecialGroup(group));
  async function findManagers() {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setSearching(true); setSearched(false); setError(""); setManager(null); setOptions([]);
    try {
      const value = demo ? { managers: demoManagementManagers.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.trim().toLowerCase())), truncated: false } : await fetch(`/api/management-managers?q=${encodeURIComponent(search.trim())}`, { signal: request.signal }).then(async (response) => {
        const payload = await response.json() as { managers: ManagementManagerOption[]; truncated: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || "People API search failed.");
        return payload;
      });
      if (!request.signal.aborted) { setOptions(value.managers); setTruncated(value.truncated); setSearched(true); }
    } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) setSearching(false); }
  }
  function add() {
    if (!manager || !destination || disabled || demo || rules.some((rule) => rule.managerId === manager.id)) return;
    onChange([...rules, { managerId: manager.id, managerName: manager.name, managerEmail: manager.email, groupId: destination }]);
    setManager(null); setSearch(""); setOptions([]); setSearched(false); setDestination("");
  }
  const visible = rules.filter((rule) => {
    const valid = targets.some((group) => group.id === rule.groupId);
    return `${rule.managerName} ${rule.managerEmail ?? ""} ${rule.managerId}`.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "all" || (filter === "mapped" && valid) || (filter === "conflict" && !valid));
  });
  return <section className="panel structure-rule-panel">
    <div className="panel-heading"><div><span className="eyebrow">Priority 3</span><h2>Manager’s structure → regular group</h2></div></div>
    <p className="table-note">Includes the selected manager and all direct and indirect reports from People API. A manager’s own rule wins over a parent structure; otherwise the nearest configured manager wins. Email-domain rules still take precedence.</p>
    <div className="structure-rule-form">
      <form onSubmit={(event) => { event.preventDefault(); void findManagers(); }}>
        <label>Find a manager<input aria-label="Find structure manager" value={search} maxLength={80} placeholder="Name or email from People API" onChange={(event) => { controller.current?.abort(); setSearching(false); setSearch(event.target.value); setManager(null); setOptions([]); setSearched(false); }} /></label>
        <button className="button button--secondary" disabled={disabled || searching || search.trim().length < 2}>{searching ? "Searching…" : "Search People API"}</button>
      </form>
      {error && <p className="access-feedback" role="alert">{error}</p>}
      {!manager && options.length > 0 && <div className="structure-search-results" aria-label="Structure manager results">{options.map((option) => <button type="button" key={option.id} className="structure-search-option" onClick={() => { setManager(option); setSearch(option.name); }}><strong>{option.name}</strong><small>{[option.email, option.title, option.department].filter(Boolean).join(" · ")}</small><small>People API ID: {option.id}</small></button>)}</div>}
      {searched && !options.length && <p role="status">No People API matches. Try a name or email.</p>}
      {!manager && truncated && options.length > 0 && <small>First 20 matches; refine the search if needed.</small>}
      {manager && <div className="structure-selected"><strong>{manager.name}</strong><small>{manager.email || "No email supplied"} · ID {manager.id}</small>{rules.some((rule) => rule.managerId === manager.id) && <small>This manager already has a rule. Edit its destination below.</small>}</div>}
      <label>Regular destination<select aria-label="Structure rule destination" value={destination} disabled={disabled} onChange={(event) => setDestination(event.target.value)}><option value="">Choose a group</option>{targets.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <button className="button button--secondary" disabled={demo || disabled || !manager || !destination || rules.some((rule) => rule.managerId === manager.id)} onClick={add}>Add structure rule</button>
      <small>Adds to your draft. Click Save rules to persist it; memberships change only after preview and confirmation.</small>
    </div>
    <div className="structure-rule-list">{visible.map((rule) => {
      const valid = targets.some((group) => group.id === rule.groupId);
      const descendants = contexts ? Object.values(contexts).filter((context) => !context.problem && (context.personId === rule.managerId || context.ancestorIds.includes(rule.managerId))).length : null;
      return <div className="structure-rule-row" key={rule.managerId}><strong>{rule.managerName}</strong><small>{rule.managerEmail || rule.managerId}</small><small>{descendants === null ? "Save rules and load structures to review people" : `${descendants} verified workspace people · includes manager if present · before domain/nested-rule precedence`}</small>
        <select aria-label={`Structure destination for ${rule.managerName}`} value={valid ? rule.groupId : "__invalid__"} disabled={demo || disabled} onChange={(event) => onChange(rules.map((item) => item.managerId === rule.managerId ? { ...item, groupId: event.target.value } : item))}>{!valid && <option value="__invalid__" disabled>Review unavailable destination</option>}{targets.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <button className="text-button" disabled={demo || disabled} onClick={() => onChange(rules.filter((item) => item.managerId !== rule.managerId))}>Remove rule for {rule.managerName}</button>
      </div>;
    })}{!visible.length && <p className="table-note">{rules.length ? "No structure rules match these filters." : "No structure rules yet. Select a manager and a regular group above."}</p>}</div>
  </section>;
}
