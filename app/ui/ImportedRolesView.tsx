"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardData } from "../types";
import { emptyRoleImport, type RoleImportState, type RoleImportResult } from "../../lib/role-import";

const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Never";

export default function ImportedRolesView({ data, onNotice }: { data: DashboardData; onNotice: (message: string) => void }) {
  const demo = data.mode === "demo";
  const [state, setState] = useState<RoleImportState>(emptyRoleImport);
  const [loaded, setLoaded] = useState(demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"groups" | "roles">("groups");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedRole, setSelectedRole] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const requestVersion = useRef(0);
  const errorAt = useRef(0);

  useEffect(() => {
    if (demo || busy) return;
    const controller = new AbortController(); const version = ++requestVersion.current;
    fetch("/api/role-import", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load the saved OpenAI configuration.");
      return response.json() as Promise<RoleImportState>;
    }).then((value) => { if (!controller.signal.aborted && version === requestVersion.current) { setState(value); setLoaded(true); if (value.snapshot && Date.parse(value.snapshot.syncedAt) >= errorAt.current) setError(""); } })
      .catch((reason) => { if (!controller.signal.aborted && version === requestVersion.current) { errorAt.current = Date.now(); setError(reason.message); } });
    return () => controller.abort();
  }, [demo, busy, data.workspaceId, data.lastSyncedAt]);

  async function refresh() {
    if (demo || busy) return;
    const version = ++requestVersion.current;
    setBusy(true); setError(""); errorAt.current = 0;
    try {
      const response = await fetch("/api/role-import", { method: "POST", headers: { "Content-Type": "application/json" } });
      const payload = await response.json() as RoleImportState & { result?: RoleImportResult };
      if (version !== requestVersion.current) return;
      if ("snapshot" in payload) { setState(payload); setLoaded(true); }
      if (!response.ok) throw new Error(payload.error || "Role import failed. The previous snapshot is unchanged.");
      onNotice(payload.result?.message || "OpenAI role configuration imported.");
    } catch (reason) { if (version === requestVersion.current) { errorAt.current = Date.now(); setError((reason as Error).message); } }
    finally { setBusy(false); }
  }

  const snapshot = state.snapshot;
  const roles = snapshot?.roles ?? []; const groups = snapshot?.groups ?? [];
  const roleName = (id: string) => roles.find((role) => role.id === id)?.name ?? id;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = groups.filter((group) => `${group.name} ${group.roleIds.map(roleName).join(" ")}`.toLowerCase().includes(normalizedQuery)
    && (filter === "all" || (filter === "unassigned" ? group.roleIds.length === 0 : group.roleIds.length > 1)));
  const visibleRoles = roles.filter((role) => `${role.name} ${groups.filter((group) => group.roleIds.includes(role.id)).map((group) => group.name).join(" ")}`.toLowerCase().includes(normalizedQuery)
    && (filter === "all" || !groups.some((group) => group.roleIds.includes(role.id))));
  const selected = roles.find((role) => role.id === selectedRole);
  const staleError = error || state.error;

  return <div className="page-content access-workspace">
    <div className="page-intro"><div><span className="eyebrow">Imported from ChatGPT workspace Admin API</span><h1>Permissions & roles</h1><p>OpenAI roles, permission states and group assignments as of the last successful import.</p></div><button className="button button--primary" disabled={demo || busy} onClick={refresh}>{busy ? "Importing…" : "Refresh from OpenAI"}</button></div>
    <div className="analytics-warning permission-source-warning"><strong>Read-only OpenAI snapshot</strong><p>Manual and automatic directory sync import this configuration. Changes to roles, permissions and role–group assignments must still be made in <a href="https://admin.openai.com/" target="_blank" rel="noreferrer">OpenAI Admin</a>. Local mapping plans remain separate and are never applied by sync.</p><p>API-reported group roles are not a calculation of each member’s effective access or direct user grants.</p></div>
    {demo && <p>Read-only demo · no OpenAI configuration imported.</p>}
    {staleError && <div className="analytics-warning" role="alert"><strong>{snapshot ? "Import not current · last complete snapshot retained" : "OpenAI configuration unavailable"}</strong><p>{staleError}</p></div>}
    <div className="panel policy-bulk" aria-label="Import status"><div><strong>Last successful import</strong><small>{date(snapshot?.syncedAt ?? null)}</small></div><div><strong>Last attempt</strong><small>{date(state.lastAttemptAt)}</small></div><div><strong>{roles.length} roles · {groups.length} groups</strong><small>{snapshot ? "Source: ChatGPT workspace Admin API" : "No saved OpenAI snapshot"}</small></div></div>
    {!snapshot ? <section className="panel empty-state"><strong>{loaded ? "No OpenAI role snapshot yet" : "Loading OpenAI configuration…"}</strong><p>Run Sync or Refresh from OpenAI to import current roles and assignments. No snapshot does not mean your workspace has no roles.</p></section> : <>
      <div className="policy-filters panel"><div className="segmented-filter"><button aria-pressed={view === "groups"} onClick={() => { setView("groups"); setFilter("all"); }}>By group</button><button aria-pressed={view === "roles"} onClick={() => { setView("roles"); setFilter("all"); }}>By role</button></div><label>Search imported configuration<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Group or OpenAI role" /></label><label>Show assignments<select aria-label="Show assignments" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="unassigned">{view === "groups" ? "No reported roles" : "No assigned groups"}</option>{view === "groups" && <option value="multiple">More than one role</option>}</select></label></div>
      <section className="panel table-scroll"><table className="policy-table"><thead><tr><th>{view === "groups" ? "Group" : "OpenAI role"}</th><th>{view === "groups" ? "API-reported roles" : "Assigned groups"}</th><th>Permission details</th></tr></thead><tbody>{view === "groups" ? visibleGroups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong></td><td>{group.roleIds.map(roleName).join(", ") || "None reported"}</td><td>{group.roleIds.map((id) => <button className="text-button" key={id} onClick={() => setSelectedRole(id)}>View {roleName(id)} permissions</button>)}</td></tr>) : visibleRoles.map((role) => <tr key={role.id}><td><strong>{role.name}</strong><small>{role.predefined ? "Predefined role" : "Custom role"}{role.inheritsDefault ? " · inherits default member role" : ""}</small></td><td>{groups.filter((group) => group.roleIds.includes(role.id)).map((group) => group.name).join(", ") || "None reported"}</td><td><button className="text-button" onClick={() => setSelectedRole(role.id)}>View {role.permissions.length} permission states</button></td></tr>)}</tbody></table>{(view === "groups" ? visibleGroups.length : visibleRoles.length) === 0 && <p className="empty-state">No matching {view}.</p>}</section>
      {selected && <section className="panel policy-review" aria-label="Imported permission details"><h2>{selected.name} · permission states</h2><p>{selected.description}</p><p>{selected.inheritsDefault ? "Inherits from the default member role. “inherit” is the API state, not resolved effective access." : "Does not inherit from the default member role."}</p><label>Find permission<input value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} placeholder="Permission name or state" /></label><div className="table-scroll permission-state-list"><table className="policy-table"><thead><tr><th>Permission</th><th>API state</th><th>Editable in OpenAI</th><th>Inheritable</th></tr></thead><tbody>{selected.permissions.filter((permission) => `${permission.name} ${permission.state}`.toLowerCase().includes(permissionQuery.toLowerCase())).map((permission) => <tr key={permission.name}><td>{permission.name}</td><td>{permission.state}</td><td>{permission.editable === null ? "Not reported" : permission.editable ? "Yes" : "No"}</td><td>{permission.inheritable === null ? "Not reported" : permission.inheritable ? "Yes" : "No"}</td></tr>)}</tbody></table></div><button className="button button--secondary" onClick={() => setSelectedRole("")}>Close permission details</button></section>}
    </>}
  </div>;
}
