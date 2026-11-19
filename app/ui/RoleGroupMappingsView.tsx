"use client";
import { useEffect, useState } from "react";
import type { DashboardData } from "../types";
import { emptyRoleGroupSettings, mappingNeedsAction, type RoleGroupSettings } from "../../lib/role-group-mappings";
import { isSpecialGroup, memberGroupIds } from "../../lib/access-policy";
import { useUnsavedWarning } from "./useUnsavedWarning";

export default function RoleGroupMappingsView({ data, onNotice }: { data: DashboardData; onNotice: (message: string) => void }) {
  const demo = data.mode === "demo";
  const [settings, setSettings] = useState<RoleGroupSettings>(emptyRoleGroupSettings);
  const [saved, setSaved] = useState<RoleGroupSettings>(emptyRoleGroupSettings);
  const [loaded, setLoaded] = useState(demo);
  const [view, setView] = useState<"roles" | "groups">("roles");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [ack, setAck] = useState(false);
  const dirty = JSON.stringify(settings.roles) !== JSON.stringify(saved.roles);
  useUnsavedWarning(loaded && !demo && (dirty || Boolean(name || externalId)));
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    fetch("/api/role-group-mappings", { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error("Could not load role mappings."); return response.json() as Promise<RoleGroupSettings>; }).then((value) => { if (!controller.signal.aborted) { setSettings(value); setSaved(value); setLoaded(true); } }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [demo]);
  function toggle(roleId: string, groupId: string) {
    setSettings((current) => ({ ...current, roles: current.roles.map((role) => role.id === roleId ? { ...role, groupIds: role.groupIds.includes(groupId) ? role.groupIds.filter((id) => id !== groupId) : [...role.groupIds, groupId] } : role) }));
    setReviewing(false);
  }
  function register() {
    if (!name.trim() || demo) return;
    setSettings((current) => ({ ...current, roles: [...current.roles, { id: crypto.randomUUID(), name: name.trim(), externalId: externalId.trim(), groupIds: [], confirmedAt: null, confirmedGroupIds: null }] }));
    setName(""); setExternalId(""); setReviewing(false);
  }
  async function save(intent: "save" | "confirm-manually") {
    if (busy || demo || (intent === "confirm-manually" && !ack)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/role-group-mappings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, revision: saved.revision, roles: settings.roles, roleId: confirmId, acknowledged: ack }) });
      const payload = await response.json() as RoleGroupSettings & { error?: string }; if (!response.ok) throw new Error(payload.error);
      setSettings(payload); setSaved(payload); setReviewing(false); setConfirmId(""); setAck(false);
      onNotice(intent === "save" ? "Role–group plan saved locally. Complete the changes in OpenAI Admin." : "Manual confirmation recorded. This is not API-verified access.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const groupNames = (ids: string[]) => ids.map((id) => data.groups.find((group) => group.id === id)?.name ?? "Deleted / unavailable group").join(", ") || "None";
  const affected = (ids: string[]) => data.members.filter((member) => { try { return memberGroupIds(member, data.groups).some((id) => ids.includes(id)); } catch { return false; } }).length;
  const changed = settings.roles.filter((role) => { const old = saved.roles.find((item) => item.id === role.id); return !old || JSON.stringify([...old.groupIds].sort()) !== JSON.stringify([...role.groupIds].sort()); });
  return <div className="page-content access-workspace"><div className="page-intro"><div><span className="eyebrow">Group-to-role relationships</span><h1>Permissions & roles</h1><p>Define roles and permissions in OpenAI Admin. Keep the intended group assignments and their manual completion status here.</p></div><a className="button button--secondary" href="https://admin.openai.com/" target="_blank" rel="noreferrer">Open OpenAI Admin</a></div>
    <div className="analytics-warning permission-source-warning"><strong>Local mapping plan · not live OpenAI permissions</strong><p>Imported roles and assignments are available in Current OpenAI configuration. This separate local plan is not overwritten by imports. An empty local plan does not mean your workspace has no roles.</p><p>Register existing roles below to keep a local plan. Saving does not change OpenAI access. Manual confirmations are your records, not API verification.</p></div>
    <div className="panel policy-bulk" aria-label="Role data sources"><div><strong>Local planning only</strong><small>Use Current OpenAI configuration to inspect the latest imported state.</small></div><div><strong>{loaded ? `${saved.roles.length} saved local role ${saved.roles.length === 1 ? "reference" : "references"}` : "Loading local role references…"}</strong><small>Source: CodexLens local database · separate from OpenAI configuration</small></div></div>
    {dirty && <div className="analytics-warning" role="status"><strong>Unsaved local mapping draft</strong><p>Kept across app tabs. Review mapping changes and save before reloading or closing the app.</p></div>}
    {demo && <p>Read-only demo.</p>}{error && <p className="access-feedback" role="alert">{error}</p>}
    <div className="policy-bulk panel"><label>Existing OpenAI role name<input placeholder="Name as shown in OpenAI Admin" value={name} onChange={(event) => setName(event.target.value)} /></label><label>OpenAI role ID (optional)<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Reference only" /></label><button className="button button--secondary" disabled={demo || !loaded || !name.trim() || busy} onClick={register}>Register role reference</button><small>This does not create a role in OpenAI.</small></div>
    <div className="policy-filters panel"><div className="segmented-filter"><button aria-pressed={view === "roles"} onClick={() => { setView("roles"); setFilter("all"); }}>By role</button><button aria-pressed={view === "groups"} onClick={() => { setView("groups"); setFilter("all"); }}>By group</button></div><label>Search<input placeholder="Role or group name" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="unassigned">Unassigned</option>{view === "roles" && <option value="pending">Manual action required</option>}</select></label><button className="button button--primary" disabled={demo || !loaded || !dirty || busy} onClick={() => setReviewing(true)}>Review mapping changes</button></div>
    <fieldset className="policy-fieldset" disabled={demo || !loaded || busy}><section className="panel table-scroll"><table className="policy-table"><thead><tr><th>{view === "roles" ? "OpenAI role reference" : "Group"}</th><th>{view === "roles" ? "Assigned groups (planned)" : "Assigned roles (planned)"}</th><th>People affected</th><th>Status</th></tr></thead><tbody>{view === "roles" ? settings.roles.filter((role) => role.name.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || (filter === "unassigned" ? !role.groupIds.length : mappingNeedsAction(role)))).map((role) => <tr key={role.id}><td><strong>{role.name}</strong><small>{role.externalId || "Name reference only"}</small></td><td><div className="mapping-multi-select">{data.groups.map((group) => <label key={group.id}><input type="checkbox" checked={role.groupIds.includes(group.id)} onChange={() => toggle(role.id, group.id)} />{group.name}{isSpecialGroup(group) && <small>special</small>}</label>)}</div>{role.groupIds.filter((id) => !data.groups.some((group) => group.id === id)).map((id) => <button className="text-button" key={id} onClick={() => toggle(role.id, id)}>Remove unavailable group reference</button>)}</td><td>{affected(role.groupIds)} unique people</td><td><span className="pill pill--warning">{mappingNeedsAction(role) ? "Manual action required" : "Manually confirmed · not API verified"}</span>{role.confirmedAt && <small>Confirmed {new Date(role.confirmedAt).toLocaleString()}</small>}<button className="text-button" disabled={dirty} onClick={() => { setConfirmId(role.id); setAck(false); }}>Record manual confirmation</button></td></tr>) : data.groups.filter((group) => group.name.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || !settings.roles.some((role) => role.groupIds.includes(group.id)))).map((group) => <tr key={group.id}><td><strong>{group.name}</strong><small>{isSpecialGroup(group) ? "Special" : "Regular"}</small></td><td><div className="mapping-multi-select">{settings.roles.map((role) => <label key={role.id}><input type="checkbox" checked={role.groupIds.includes(group.id)} onChange={() => toggle(role.id, group.id)} />{role.name}</label>)}</div></td><td>{affected([group.id])}</td><td>Local plan only</td></tr>)}</tbody></table>{!settings.roles.length && <div className="empty-state"><strong>{loaded ? "No local role references registered" : "Loading local role references…"}</strong><p>Your OpenAI roles may already be configured; they are not imported here. Register an existing OpenAI role above to plan its group relationships.</p></div>}</section></fieldset>
    {reviewing && <section className="panel policy-review"><h2>Review local mapping changes</h2>{changed.map((role) => <p key={role.id}><strong>{role.name}</strong>: {groupNames(saved.roles.find((old) => old.id === role.id)?.groupIds ?? [])} → {groupNames(role.groupIds)}<small>{affected([...new Set([...role.groupIds, ...(saved.roles.find((old) => old.id === role.id)?.groupIds ?? [])])])} unique people potentially affected</small></p>)}<p>This saves a local plan only. Apply it in OpenAI Admin, then record manual confirmation.</p><button className="button button--primary" disabled={busy} onClick={() => save("save")}>Save local mapping plan</button><button className="button button--secondary" onClick={() => setReviewing(false)}>Cancel</button></section>}
    {confirmId && <section className="panel policy-review"><h2>Record manual confirmation</h2><p>{settings.roles.find((role) => role.id === confirmId)?.name}: {groupNames(settings.roles.find((role) => role.id === confirmId)?.groupIds ?? [])}</p><label><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />I checked this role’s complete group assignment in OpenAI Admin and it matches this plan.</label><p>This records your confirmation time only. Compare with Current OpenAI configuration after importing; local plans are not automatically reconciled.</p><button className="button button--primary" disabled={!ack || busy || dirty} onClick={() => save("confirm-manually")}>Record confirmation</button><button className="button button--secondary" onClick={() => setConfirmId("")}>Cancel</button></section>}
  </div>;
}
