"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { DashboardData } from "../types";
import type { StructureCoverageData } from "../../lib/structure-coverage";

export default function StructureCoverage({ data, startDate, endDate, entity, groupId }: { data: DashboardData; startDate: string; endDate: string; entity: string; groupId: string }) {
  const [result, setResult] = useState<{ key: string; data: StructureCoverageData } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const demo = data.mode === "demo";
  const key = `${data.workspaceId}:${data.lastSyncedAt}:${startDate}:${endDate}:${entity}:${groupId}:${revision}`;
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ start: startDate, end: endDate });
    if (entity) params.set("entity", entity);
    if (groupId) params.set("group", groupId);
    fetch(`/api/structure-coverage?${params}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as StructureCoverageData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load N-1 coverage.");
      if (!controller.signal.aborted) { setResult({ key, data: payload }); setError(null); }
    }).catch((reason) => { if (!controller.signal.aborted) setError({ key, message: reason instanceof Error ? reason.message : "Could not load N-1 coverage." }); });
    return () => controller.abort();
  }, [demo, key, startDate, endDate, entity, groupId]);
  const coverage = result?.key === key ? result.data : null;
  const failure = error?.key === key ? error.message : null;
  const total = coverage?.totals;
  const percent = (value: number | null) => value === null ? "—" : `${(100 * value).toFixed(1)}%`;
  const issues = coverage ? coverage.quality.unmatched + coverage.quality.ambiguous + coverage.quality.inactive + coverage.quality.outside + coverage.quality.brokenHierarchy + coverage.quality.duplicateAccounts : 0;
  return <section className="panel structure-coverage">
    <div className="panel-heading"><div><span className="eyebrow">N‑1 structures · workspace reach</span><h2>Workspace coverage by leadership structure</h2></div><button className="button button--secondary" disabled={demo || (!coverage && !failure)} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} />Refresh coverage</button></div>
    <p className="table-note">{coverage ? `People at ${coverage.anchor.name}’s level` : "The reference leader’s peers"} and their full reporting structures. Headcount and workspace membership are current snapshots, not historical access. Only recorded activity changes with the selected period.</p>
    {demo ? <div className="empty-state"><strong>N‑1 coverage needs connected directories</strong><p>Demo users do not represent the company headcount. Connect People API and the ChatGPT workspace to calculate coverage.</p></div> : failure ? <div className="analytics-warning analytics-warning--error" role="alert">{failure}</div> : !coverage ? <div className="analytics-loading"><LoaderCircle className="spin" size={20} />Loading full People API structures and OpenAI membership…</div> : <>
      <div className="structure-scope"><strong>Direct reports of {coverage.root.name}</strong><span>Reference leader: {coverage.anchor.name} · {coverage.rows.length} structures</span><span>{entity || "All entities"} · {coverage.groupName ? `Members of ${coverage.groupName}` : "All accepted workspace members"}</span></div>
      <div className="structure-totals"><span><small>Active people in structures</small><strong>{total!.totalPeople.toLocaleString()}</strong></span><span><small>In workspace{coverage.groupId ? " / selected group" : ""}</small><strong>{total!.workspacePeople.toLocaleString()} <em>{percent(total!.totalPeople ? total!.workspacePeople / total!.totalPeople : null)}</em></strong></span><span><small>ChatGPT / Codex-only seats</small><strong>{total!.chatgptSeats.toLocaleString()} / {total!.codexSeats.toLocaleString()}</strong></span><span><small>Recorded active · {startDate} – {endDate}</small><strong>{total!.activeUsers.toLocaleString()}</strong></span></div>
      <div className="table-scroll"><table className="structure-table"><thead><tr><th>N‑1 leader / structure</th><th>People</th><th>In workspace</th><th>Coverage</th><th>ChatGPT seat</th><th>Codex-only seat</th><th>Unknown seat</th><th>Active in period</th></tr></thead><tbody>{coverage.rows.map((row) => <tr key={row.id} className={row.id === coverage.anchor.id ? "structure-anchor" : ""}><td><span><strong>{row.name}{row.id === coverage.anchor.id ? " · reference" : ""}</strong><small>{row.title}</small>{!row.leaderActive && <small>Inactive leader; active descendants still included</small>}</span></td><td>{row.totalPeople.toLocaleString()}</td><td>{row.workspacePeople.toLocaleString()}</td><td><div className="structure-bar"><span style={{ width: `${Math.min(100, (row.coverage ?? 0) * 100)}%` }} /></div><strong>{percent(row.coverage)}</strong></td><td>{row.chatgptSeats}</td><td>{row.codexSeats}</td><td>{row.unknownSeats || "—"}</td><td>{row.activeUsers}</td></tr>)}</tbody></table></div>
      <div className="structure-notes"><p>Denominator: current People API profiles with <code>isActive=true</code>, including active contractors and the leader, followed by stable manager IDs through all reporting levels. Entity filters apply to both sides. {coverage.groupId ? "The group filter limits workspace membership and activity only; the People API headcount remains the full structure for that entity." : "Each person is counted once; the parent manager is outside the N‑1 rows."}</p><p>Seat types describe the purchased product seat, not effective feature permissions. A ChatGPT seat must not be interpreted as “no Codex access”. Activity means non-zero imported usage or turns during {startDate} – {endDate}; source: {coverage.usageSource}. Unknown seat types are never guessed.</p><p>People API snapshot: {new Date(coverage.peopleAsOf).toLocaleString()} (cached up to 10 minutes). OpenAI membership: {new Date(coverage.workspaceAsOf).toLocaleString()}. Groups: last directory sync.</p>
      {coverage.quality.unresolvedDirectoryPeople > 0 && <p className="structure-quality"><strong>Headcount may be incomplete:</strong> {coverage.quality.unresolvedDirectoryPeople} active People API profiles in this entity scope have missing managers or cyclic reporting paths and cannot be assigned to a structure.</p>}
      {issues > 0 && <p className="structure-quality"><strong>{issues} workspace accounts not included in coverage:</strong> {coverage.quality.unmatched} unmatched emails; {coverage.quality.ambiguous} ambiguous People API emails; {coverage.quality.duplicateAccounts} duplicate accounts; {coverage.quality.inactive} inactive People profiles; {coverage.quality.outside} outside these structures; {coverage.quality.brokenHierarchy} broken reporting paths. No fuzzy name matching is used.</p>}</div>
    </>}
  </section>;
}
