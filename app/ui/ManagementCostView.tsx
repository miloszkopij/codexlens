"use client";

import {
  Activity, AlertTriangle, CalendarDays, CircleDollarSign, LoaderCircle, Network,
  RotateCcw, Search, Settings, Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { demoManagementData, demoManagementManagers } from "../demo-data";
import type { AppSettings, Currency, DashboardData, ManagementCostData, ManagementManagerOption } from "../types";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return isoDate(new Date());
}

function daysBefore(endDate: string, days: number) {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

function currentBillingCycle(settings: AppSettings) {
  const now = new Date(`${todayIso()}T00:00:00Z`);
  const anchor = settings.billingPeriodStart ? new Date(`${settings.billingPeriodStart}T00:00:00Z`) : null;
  const startDay = anchor && !Number.isNaN(anchor.getTime()) ? anchor.getUTCDate() : 20;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), startDay));
  if (now < start) start.setUTCMonth(start.getUTCMonth() - 1);
  const cycleEnd = new Date(start);
  cycleEnd.setUTCMonth(cycleEnd.getUTCMonth() + 1);
  cycleEnd.setUTCDate(cycleEnd.getUTCDate() - 1);
  return { startDate: isoDate(start), endDate: todayIso(), cycleEnd: isoDate(cycleEnd) };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 10 ? 2 : 0 }).format(value);
}

function formatMoney(value: number | null, currency: Currency) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
}

type ManagerListResponse = {
  defaultManager?: ManagementManagerOption | null;
  managers?: ManagementManagerOption[];
  truncated?: boolean;
  error?: string;
};

export default function ManagementCostView({ data, onOpenSettings, selectedManager: selectedManagerProp, onManagerChange }: {
  data: DashboardData;
  onOpenSettings: () => void;
  selectedManager: ManagementManagerOption | null;
  onManagerChange: (manager: ManagementManagerOption | null) => void;
}) {
  const currentCycle = useMemo(() => currentBillingCycle(data.settings), [data.settings]);
  const isDemo = data.mode === "demo";
  const demoDefaultManager = demoManagementManagers[0];
  const selectedManager = isDemo
    ? (selectedManagerProp?.id.startsWith("demo-") ? selectedManagerProp : demoDefaultManager)
    : (selectedManagerProp && !selectedManagerProp.id.startsWith("demo-") ? selectedManagerProp : null);
  const [startDate, setStartDate] = useState(currentCycle.startDate);
  const [endDate, setEndDate] = useState(currentCycle.endDate);
  const [liveDefaultManager, setLiveDefaultManager] = useState<ManagementManagerOption | null>(null);
  const [managerQuery, setManagerQuery] = useState(selectedManager?.name ?? (isDemo ? demoDefaultManager.name : ""));
  const [managerOptions, setManagerOptions] = useState<ManagementManagerOption[]>(isDemo ? demoManagementManagers : []);
  const [managerPickerOpen, setManagerPickerOpen] = useState(false);
  const [managerSearchLoading, setManagerSearchLoading] = useState(false);
  const [managerSearchError, setManagerSearchError] = useState<string | null>(null);
  const [managerSearchTruncated, setManagerSearchTruncated] = useState(false);
  const [management, setManagement] = useState<ManagementCostData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedManagerRef = useRef(selectedManager);
  const managerQueryDirtyRef = useRef(false);
  const managerSearchRequestRef = useRef(0);
  const managementRequestRef = useRef(0);

  useEffect(() => {
    selectedManagerRef.current = selectedManager;
  }, [selectedManager]);

  useEffect(() => {
    const controller = new AbortController();
    if (isDemo) {
      return () => controller.abort();
    }
    fetch("/api/management-managers", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ManagerListResponse;
        if (!response.ok || !payload.defaultManager) throw new Error(payload.error || "The default manager could not be loaded.");
        return payload.defaultManager;
      })
      .then((candidate) => {
        setLiveDefaultManager(candidate);
        if (!selectedManagerRef.current) {
          onManagerChange(candidate);
          if (!managerQueryDirtyRef.current) setManagerQuery(candidate.name);
        }
        setManagerSearchError(null);
      })
      .catch((reason) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "The default manager could not be loaded.");
    });
    return () => controller.abort();
  }, [isDemo, onManagerChange]);

  useEffect(() => {
    const requestId = managerSearchRequestRef.current + 1;
    managerSearchRequestRef.current = requestId;
    const query = managerQuery.trim();
    if (!managerPickerOpen || query.length < 2) {
      return;
    }
    if (isDemo) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setManagerSearchLoading(true);
      setManagerSearchError(null);
      fetch(`/api/management-managers?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as ManagerListResponse;
          if (!response.ok) throw new Error(payload.error || "Manager search failed.");
          return payload;
        })
        .then((payload) => { if (managerSearchRequestRef.current !== requestId) return; setManagerOptions(payload.managers ?? []); setManagerSearchTruncated(Boolean(payload.truncated)); })
        .catch((reason) => { if (managerSearchRequestRef.current === requestId && reason instanceof Error && reason.name !== "AbortError") { setManagerOptions([]); setManagerSearchError(reason instanceof Error ? reason.message : "Manager search failed."); } })
        .finally(() => { if (managerSearchRequestRef.current === requestId) setManagerSearchLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isDemo, managerPickerOpen, managerQuery]);

  useEffect(() => {
    const requestId = managementRequestRef.current + 1;
    managementRequestRef.current = requestId;
    if (!selectedManager || isDemo || selectedManager.id.startsWith("demo-")) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ managerId: selectedManager.id, start: startDate, end: endDate });
    fetch(`/api/management-cost?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ManagementCostData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Management costs could not be loaded.");
        return payload;
      })
      .then((payload) => { if (managementRequestRef.current !== requestId) return; setManagement(payload); setError(null); })
      .catch((reason) => { if (managementRequestRef.current === requestId && reason instanceof Error && reason.name !== "AbortError") { setManagement(null); setError(reason instanceof Error ? reason.message : "Management costs could not be loaded."); } });
    return () => controller.abort();
  }, [data, endDate, isDemo, selectedManager, startDate]);

  function selectManager(manager: ManagementManagerOption) {
    onManagerChange(manager);
    setManagerQuery(manager.name);
    managerQueryDirtyRef.current = false;
    setManagerPickerOpen(false);
    setManagerSearchError(null);
    setError(null);
  }

  function resetManager() {
    const defaultManager = isDemo ? demoDefaultManager : liveDefaultManager;
    if (defaultManager) selectManager(defaultManager);
  }

  function useCurrentCycle() {
    setStartDate(currentCycle.startDate);
    setEndDate(currentCycle.endDate);
  }

  function useSnapshot() {
    if (!data.settings.billingPeriodStart || !data.settings.billingPeriodEnd) return onOpenSettings();
    setStartDate(data.settings.billingPeriodStart);
    setEndDate(data.settings.billingPeriodEnd);
  }

  const displayedManagement = isDemo && selectedManager ? demoManagementData(data, startDate, endDate, selectedManager.id) : management;
  const currency = displayedManagement?.currency ?? data.settings.currency;
  const leaderName = selectedManager?.name ?? displayedManagement?.leader.name ?? "Manager";
  const period = `${startDate} – ${endDate}`;
  const defaultManager = isDemo ? demoDefaultManager : liveDefaultManager;
  const managerLoading = !isDemo && !liveDefaultManager && !error;
  const loading = managerLoading || !selectedManager || !displayedManagement || displayedManagement.startDate !== startDate || displayedManagement.endDate !== endDate || displayedManagement.leader.id !== selectedManager.id;
  const directRows = displayedManagement?.rows.filter((row) => !row.reconciliation) ?? [];
  const reconciliation = displayedManagement?.rows.find((row) => row.reconciliation);
  const searchVisible = managerPickerOpen && managerQuery.trim().length >= 2;
  const visibleManagerOptions = isDemo
    ? demoManagementManagers.filter((manager) => [manager.name, manager.email ?? "", manager.title ?? "", manager.department ?? ""].join(" ").toLowerCase().includes(managerQuery.trim().toLowerCase()))
    : managerOptions;

  return <div className="page-content management-page">
    <div className="page-intro">
      <div><span className="eyebrow">Management usage ownership</span><h1>{leaderName}&apos;s teams</h1><p>Select a People API manager to see direct-report teams, attributed usage value, and their share of workspace usage. These are not invoice charges.</p></div>
      <div className="page-actions"><button className="button button--secondary" onClick={onOpenSettings}><Settings size={16} />Billing snapshot</button></div>
    </div>

    <section className="analytics-controls management-controls panel">
      <div className="manager-picker-field"><span className="control-label">Manager</span><div className="manager-picker"><Search size={15} /><input role="combobox" aria-label="Search manager" aria-expanded={searchVisible} aria-controls="manager-results" value={managerQuery} placeholder="Search by name or email" onFocus={() => setManagerPickerOpen(true)} onChange={(event) => { managerQueryDirtyRef.current = true; setManagerQuery(event.target.value); setManagerPickerOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setManagerPickerOpen(false); if (event.key === "Enter" && visibleManagerOptions[0]) { event.preventDefault(); selectManager(visibleManagerOptions[0]); } }} />{searchVisible && <div id="manager-results" className="manager-results" role="listbox">{managerSearchLoading && <div className="manager-result-status"><LoaderCircle className="spin" size={14} />Searching People API…</div>}{!managerSearchLoading && visibleManagerOptions.map((manager) => <button type="button" role="option" aria-selected={manager.id === selectedManager?.id} key={manager.id} onMouseDown={(event) => { event.preventDefault(); selectManager(manager); }}><span className="avatar avatar--small">{initials(manager.name)}</span><span><strong>{manager.name}</strong><small>{[manager.title, manager.department, manager.email].filter(Boolean).join(" · ")}</small></span></button>)}{!managerSearchLoading && !visibleManagerOptions.length && <div className="manager-result-status">No People API matches.</div>}{managerSearchTruncated && <div className="manager-result-status">Showing the first 20 matches.</div>}</div>}</div><div className="manager-picker-meta">{managerSearchError ? <span className="manager-search-error">{managerSearchError}</span> : <span>Search People API; managers do not need a Codex seat.</span>}<button type="button" className="text-button" onClick={resetManager} disabled={!defaultManager || selectedManager?.id === defaultManager.id}><RotateCcw size={12} />Reset to default</button></div></div>
      <div className="preset-buttons"><button onClick={useCurrentCycle}>Current cycle</button><button onClick={() => { const end = todayIso(); setStartDate(daysBefore(end, 29)); setEndDate(end); }}>30D</button><button onClick={useSnapshot}>Saved period</button></div>
      <label><span>From</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={endDate} min={startDate} max={todayIso()} onChange={(event) => setEndDate(event.target.value)} /></label>
      <div className="management-period"><CalendarDays size={15} /><span><strong>{period}</strong><small>Current billing cycle ends {currentCycle.cycleEnd}</small></span></div>
    </section>

    {error && <div className="analytics-warning analytics-warning--error"><AlertTriangle size={16} />{error}</div>}
    {displayedManagement?.warning && <div className="analytics-warning"><AlertTriangle size={16} />{displayedManagement.warning}</div>}
    {loading && <div className="management-loading panel"><LoaderCircle className="spin" size={17} />{managerLoading ? "Loading the default manager…" : `Resolving ${leaderName}'s People API reporting lines and usage…`}</div>}

    {!loading && displayedManagement && <>
      <section className="management-kpis">
        <article className="metric-card"><div className="metric-top"><span>{leaderName} teams attributed value</span><i><CircleDollarSign size={18} /></i></div><strong className="metric-value">{formatMoney(displayedManagement.selectedOrgAllocatedCost, currency)}</strong><div className="metric-bottom"><span>{formatPercent(displayedManagement.selectedOrgInvoiceShare)} of total workspace usage · not an invoice</span></div></article>
        <article className="metric-card"><div className="metric-top"><span>{leaderName} teams usage</span><i><Activity size={18} /></i></div><strong className="metric-value">{formatNumber(displayedManagement.selectedOrgUsage)}</strong><div className="metric-bottom"><span>{displayedManagement.unit} · {period}</span></div></article>
        <article className="metric-card"><div className="metric-top"><span>Direct reports</span><i><Network size={18} /></i></div><strong className="metric-value">{directRows.length}</strong><div className="metric-bottom"><span>People API reporting teams</span></div></article>
        <article className="metric-card"><div className="metric-top"><span>Mapped Codex members</span><i><Users size={18} /></i></div><strong className="metric-value">{displayedManagement.mappedMembers}</strong><div className="metric-bottom"><span>{displayedManagement.unresolvedMembers} outside teams or unresolved</span></div></article>
      </section>

      <section className="panel allocation-explainer">
        <span><CircleDollarSign size={17} /></span><div><strong>Usage attribution, not invoice allocation</strong><p>Each team&apos;s share is its fraction of workspace {displayedManagement.unit}. USD values sum per-user source estimates; the reconciliation row contains former and unresolved accounts. OpenAI Billing remains authoritative for payable spend.</p></div><div><small>Workspace usage value</small><strong>{formatMoney(displayedManagement.workspaceUsageValue, currency)}</strong><em>{period}</em></div>
      </section>

      {!directRows.length && <div className="management-empty panel"><Network size={20} /><div><strong>No direct reports found</strong><p>People API returned no direct reports for {leaderName}. The reconciliation row remains visible so the selected period&apos;s workspace usage is not hidden.</p></div></div>}

      <section className="panel management-table">
        <div className="panel-heading"><div><span className="eyebrow">Direct-manager roll-up</span><h2>{leaderName}&apos;s management teams</h2></div><span className="source-chip">{displayedManagement.source}</span></div>
        <div className="table-scroll"><table><thead><tr><th>Direct manager</th><th>Current members</th><th>Active</th><th>Usage</th><th>Share of selected teams</th><th>Share of workspace usage</th><th>Attributed value</th></tr></thead><tbody>
          {directRows.map((row) => <tr key={row.id}><td><span className="avatar avatar--small">{initials(row.name)}</span><span><strong>{row.name}</strong><small>{[row.title, row.department].filter(Boolean).join(" · ") || "People API direct report"}</small></span></td><td>{row.memberCount}</td><td>{row.activeUsers}</td><td><strong className="mono-value">{formatNumber(row.usage)}</strong></td><td><span className="share-cell"><strong>{formatPercent(row.selectedOrgShare)}</strong><i><b style={{ width: `${Math.max(1, row.selectedOrgShare * 100)}%` }} /></i></span></td><td><strong className="invoice-share">{formatPercent(row.invoiceShare)}</strong></td><td><strong className="mono-value">{formatMoney(row.usageValue, currency)}</strong></td></tr>)}
          {reconciliation && <tr className="reconciliation-row"><td><span className="reconciliation-icon"><RotateCcw size={15} /></span><span><strong>{reconciliation.name}</strong><small>Former members / outside selected teams</small></span></td><td>{reconciliation.memberCount}</td><td>{reconciliation.activeUsers}</td><td><strong className="mono-value">{formatNumber(reconciliation.usage)}</strong></td><td>—</td><td><strong className="invoice-share">{formatPercent(reconciliation.invoiceShare)}</strong></td><td><strong className="mono-value">{formatMoney(reconciliation.usageValue, currency)}</strong></td></tr>}
        </tbody><tfoot><tr><td>Workspace total</td><td>{data.members.length} current</td><td>{displayedManagement.rows.reduce((sum, row) => sum + row.activeUsers, 0)}</td><td>{formatNumber(displayedManagement.workspaceUsage)}</td><td>{formatPercent(displayedManagement.selectedOrgInvoiceShare)} in selected teams</td><td>100%</td><td>{formatMoney(displayedManagement.workspaceUsageValue, currency)}</td></tr></tfoot></table></div>
      </section>
    </>}
  </div>;
}
