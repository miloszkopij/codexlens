"use client";

import {
  Activity, AlertTriangle, CalendarDays, CircleDollarSign, LoaderCircle, Network,
  RefreshCw, Settings, Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppSettings, Currency, DashboardData, ManagementCostData } from "../types";

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

export default function ManagementCostView({ data, onOpenSettings }: { data: DashboardData; onOpenSettings: () => void }) {
  const currentCycle = useMemo(() => currentBillingCycle(data.settings), [data.settings]);
  const [startDate, setStartDate] = useState(currentCycle.startDate);
  const [endDate, setEndDate] = useState(currentCycle.endDate);
  const [management, setManagement] = useState<ManagementCostData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ start: startDate, end: endDate });
    fetch(`/api/management-cost?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ManagementCostData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Management costs could not be loaded.");
        return payload;
      })
      .then((payload) => { setManagement(payload); setError(null); })
      .catch((reason) => { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); })
    return () => controller.abort();
  }, [data.lastSyncedAt, data.settings, endDate, startDate]);

  function useCurrentCycle() {
    setStartDate(currentCycle.startDate);
    setEndDate(currentCycle.endDate);
  }

  function useSnapshot() {
    if (!data.settings.billingPeriodStart || !data.settings.billingPeriodEnd) return onOpenSettings();
    setStartDate(data.settings.billingPeriodStart);
    setEndDate(data.settings.billingPeriodEnd);
  }

  const currency = management?.currency ?? data.settings.currency;
  const leaderName = management?.leader.name ?? "David Roberts";
  const period = `${startDate} – ${endDate}`;
  const loading = !management || management.startDate !== startDate || management.endDate !== endDate;
  const directRows = management?.rows.filter((row) => !row.reconciliation) ?? [];
  const reconciliation = management?.rows.find((row) => row.reconciliation);

  return <div className="page-content management-page">
    <div className="page-intro">
      <div><span className="eyebrow">Management cost ownership</span><h1>{leaderName}&apos;s organization</h1><p>See how every direct manager&apos;s full reporting subtree uses the workspace and what fraction of the selected invoice it represents.</p></div>
      <div className="page-actions"><button className="button button--secondary" onClick={onOpenSettings}><Settings size={16} />Billing snapshot</button></div>
    </div>

    <section className="analytics-controls management-controls panel">
      <div className="preset-buttons"><button onClick={useCurrentCycle}>Current cycle</button><button onClick={() => { const end = todayIso(); setStartDate(daysBefore(end, 29)); setEndDate(end); }}>30D</button><button onClick={useSnapshot}>Saved invoice</button></div>
      <label><span>From</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={endDate} min={startDate} max={todayIso()} onChange={(event) => setEndDate(event.target.value)} /></label>
      <div className="management-period"><CalendarDays size={15} /><span><strong>{period}</strong><small>Current billing cycle ends {currentCycle.cycleEnd}</small></span></div>
    </section>

    {error && <div className="analytics-warning analytics-warning--error"><AlertTriangle size={16} />{error}</div>}
    {management?.warning && <div className="analytics-warning"><AlertTriangle size={16} />{management.warning}</div>}
    {loading && <div className="management-loading panel"><LoaderCircle className="spin" size={17} />Resolving People API reporting lines and usage…</div>}

    {!loading && management && <>
      <section className="management-kpis">
        <article className="metric-card"><div className="metric-top"><span>David org invoice allocation</span><i><CircleDollarSign size={18} /></i></div><strong className="metric-value">{management.invoiceAllocationAvailable ? formatMoney(management.davidOrgAllocatedCost, currency) : "Snapshot needed"}</strong><div className="metric-bottom"><span>{formatPercent(management.davidOrgInvoiceShare)} of total workspace invoice</span></div></article>
        <article className="metric-card"><div className="metric-top"><span>David org usage</span><i><Activity size={18} /></i></div><strong className="metric-value">{formatNumber(management.davidOrgUsage)}</strong><div className="metric-bottom"><span>{management.unit} · {period}</span></div></article>
        <article className="metric-card"><div className="metric-top"><span>Reporting teams</span><i><Network size={18} /></i></div><strong className="metric-value">{directRows.length}</strong><div className="metric-bottom"><span>Direct managers from People API</span></div></article>
        <article className="metric-card"><div className="metric-top"><span>Mapped Codex members</span><i><Users size={18} /></i></div><strong className="metric-value">{management.mappedMembers}</strong><div className="metric-bottom"><span>{management.unresolvedMembers} outside org or unresolved</span></div></article>
      </section>

      <section className="panel allocation-explainer">
        <span><CircleDollarSign size={17} /></span><div><strong>Invoice allocation</strong><p>Each team&apos;s invoice fraction equals its share of total workspace {management.unit}. Allocated cost = selected estimated invoice × invoice fraction. This makes all teams plus the reconciliation row add to exactly 100%.</p></div><div><small>Selected estimated invoice</small><strong>{management.invoiceAllocationAvailable ? formatMoney(management.estimatedInvoice, currency) : "No matching snapshot"}</strong><em>{management.invoiceSnapshotPeriod ?? "Billing period not saved"}</em></div>
      </section>

      <section className="panel management-table">
        <div className="panel-heading"><div><span className="eyebrow">Direct-manager roll-up</span><h2>{leaderName}&apos;s management teams</h2></div><span className="source-chip">{management.source}</span></div>
        <div className="table-scroll"><table><thead><tr><th>Direct manager</th><th>Codex members</th><th>Active</th><th>Usage</th><th>Share of David org</th><th>Fraction of invoice</th><th>Allocated invoice</th></tr></thead><tbody>
          {directRows.map((row) => <tr key={row.id}><td><span className="avatar avatar--small">{row.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{row.name}</strong><small>{[row.title, row.department].filter(Boolean).join(" · ") || "People API direct report"}</small></span></td><td>{row.memberCount}</td><td>{row.activeUsers}</td><td><strong className="mono-value">{formatNumber(row.usage)}</strong><small>{formatMoney(row.usageValue, currency)} usage value</small></td><td><span className="share-cell"><strong>{formatPercent(row.davidOrgShare)}</strong><i><b style={{ width: `${Math.max(1, row.davidOrgShare * 100)}%` }} /></i></span></td><td><strong className="invoice-share">{formatPercent(row.invoiceShare)}</strong></td><td><strong className="mono-value">{management.invoiceAllocationAvailable ? formatMoney(row.allocatedInvoiceCost, currency) : "—"}</strong></td></tr>)}
          {reconciliation && <tr className="reconciliation-row"><td><span className="reconciliation-icon"><RefreshCw size={15} /></span><span><strong>{reconciliation.name}</strong><small>Balances this table to the whole workspace</small></span></td><td>{reconciliation.memberCount}</td><td>{reconciliation.activeUsers}</td><td><strong className="mono-value">{formatNumber(reconciliation.usage)}</strong><small>{formatMoney(reconciliation.usageValue, currency)} usage value</small></td><td>—</td><td><strong className="invoice-share">{formatPercent(reconciliation.invoiceShare)}</strong></td><td><strong className="mono-value">{management.invoiceAllocationAvailable ? formatMoney(reconciliation.allocatedInvoiceCost, currency) : "—"}</strong></td></tr>}
        </tbody><tfoot><tr><td>Workspace total</td><td>{data.members.length}</td><td>{management.rows.reduce((sum, row) => sum + row.activeUsers, 0)}</td><td>{formatNumber(management.workspaceUsage)}</td><td>{formatPercent(management.davidOrgInvoiceShare)} in David org</td><td>100%</td><td>{management.invoiceAllocationAvailable ? formatMoney(management.estimatedInvoice, currency) : "—"}</td></tr></tfoot></table></div>
      </section>
    </>}
  </div>;
}
