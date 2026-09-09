"use client";

import {
  Activity, AlertTriangle, BarChart3, Bell, Building2, CalendarDays, Check, ChevronDown,
  ChevronRight, CircleDollarSign, Command, Download, ExternalLink, FileUp,
  Gauge, GitCompareArrows, Group, LayoutDashboard, ListChecks, LoaderCircle, Menu, MoreHorizontal,
  RefreshCw, Search, Settings, ShieldCheck, SlidersHorizontal, TrendingDown, TrendingUp, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { demoData } from "../demo-data";
import type {
  AnalyticsBreakdownRow, AnalyticsBucket, AnalyticsData, AppSettings, ChangeEvent,
  Currency, DashboardData, Entity, Member, WorkspaceGroup,
} from "../types";
import BubbleLogo from "./BubbleLogo";
import ManagementCostView from "./ManagementCostView";
import OrganizerView from "./OrganizerView";

type View = "overview" | "analytics" | "management" | "members" | "organize" | "changes";
type EntityFilter = "All" | Entity;
type AnalyticsTab = "users" | "groups" | "entities";
type TrendMetric = "invoice" | "value" | "usage";

const navItems: Array<{ id: View; label: string; icon: typeof Users }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "management", label: "David's org", icon: Group },
  { id: "members", label: "Members", icon: Users },
  { id: "organize", label: "Organize", icon: ListChecks },
  { id: "changes", label: "Changes", icon: GitCompareArrows },
];

const entityColors: Record<Entity, string> = {
  Allegro: "#f36f35", eBilet: "#ef4c66", Ceneo: "#27a7e8", Unknown: "#888a8d",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 10 ? 2 : 0 }).format(value);
}

function formatMoney(value: number | null, currency: Currency) {
  if (value === null) return "Set price";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function usageValue(usage: number, data: Pick<DashboardData, "usageUnit" | "settings">) {
  if (data.usageUnit === "usd") return usage;
  if (data.usageUnit === "credits" && data.settings.pricePerCredit !== null) return usage * data.settings.pricePerCredit;
  return null;
}

function costCurrency(data: Pick<DashboardData, "usageUnit" | "settings">): Currency {
  return data.usageUnit === "usd" ? "USD" : data.settings.currency;
}

function estimatedInvoice(settings: AppSettings) {
  if (settings.unbilledOverageCredits === null || settings.pricePerCredit === null) return null;
  return settings.unbilledOverageCredits * settings.pricePerCredit;
}

type InvoiceAllocationModel = {
  referenceInvoice: number;
  referenceUsage: number;
  overageShare: number;
  estimatedCostPerUsageCredit: number;
  referencePeriod: string;
};

function invoiceAllocationModel(settings: AppSettings, reference: AnalyticsData | null): InvoiceAllocationModel | null {
  const referenceInvoice = estimatedInvoice(settings);
  if (
    referenceInvoice === null || !reference || reference.unit !== "credits" || reference.totals.usage <= 0 ||
    reference.startDate !== settings.billingPeriodStart || reference.endDate !== settings.billingPeriodEnd ||
    settings.unbilledOverageCredits === null
  ) return null;
  return {
    referenceInvoice,
    referenceUsage: reference.totals.usage,
    overageShare: settings.unbilledOverageCredits / reference.totals.usage,
    estimatedCostPerUsageCredit: referenceInvoice / reference.totals.usage,
    referencePeriod: `${reference.startDate} – ${reference.endDate}`,
  };
}

function billingPeriodLabel(settings: AppSettings) {
  return settings.billingPeriodStart || settings.billingPeriodEnd
    ? `${settings.billingPeriodStart ?? "—"} – ${settings.billingPeriodEnd ?? "—"}`
    : "Billing period not recorded";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function actorIdentity(name?: string | null, email?: string | null) {
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} · ${email}`;
  return name || email || null;
}

function memberAdditionLabel(member: Member) {
  const identity = actorIdentity(member.addedByName, member.addedByEmail);
  if (identity) return identity;
  if (member.additionSource === "SCIM") return "Identity provider (SCIM)";
  return "Unknown — not provided by directory API";
}

function changeAttribution(change: ChangeEvent) {
  const identity = actorIdentity(change.actorName, change.actorEmail);
  const label = change.action === "Member joined" ? "Added by" : "Changed by";
  if (identity) return `${label}: ${identity}`;
  if (change.actorSource === "SCIM") return `${label}: Identity provider (SCIM)`;
  if (change.actorSource === "Codexlens") return `${label}: Unknown local admin · via Codexlens`;
  if (change.actorSource === "Legacy snapshot") return `${label}: Not recorded · legacy event`;
  return `${label}: Unknown · detected by directory sync`;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function sourceLabel(data: DashboardData) {
  if (data.mode === "live") return "Live workspace data";
  if (data.mode === "cached") return "Last saved snapshot";
  return "Demo preview";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBefore(endDate: string, days: number) {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(startDate: string, endDate: string) {
  return Math.max(1, Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000) + 1);
}

function previousPeriod(startDate: string, endDate: string) {
  const length = inclusiveDays(startDate, endDate);
  const previousEnd = shiftIsoDate(startDate, -1);
  return { startDate: shiftIsoDate(previousEnd, -(length - 1)), endDate: previousEnd };
}

function percentDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function illustrativeAnalytics(data: DashboardData, startDate: string, endDate: string, bucket: AnalyticsBucket): AnalyticsData {
  const memberRows = data.members.map((member) => ({
    id: member.id, label: member.name, sublabel: `${member.email} · ${member.entity}`,
    usage: member.usage, usageValue: usageValue(member.usage, data), messages: member.messages,
    activeUsers: member.usage > 0 ? 1 : 0, memberCount: 1,
  }));
  const totalUsage = memberRows.reduce((sum, row) => sum + row.usage, 0);
  const totalValue = usageValue(totalUsage, data);
  const activeUsers = memberRows.filter((row) => row.usage > 0).length;
  const byEntity = (["Allegro", "eBilet", "Ceneo", "Unknown"] as Entity[]).map((entityName) => {
    const members = data.members.filter((member) => member.entity === entityName);
    const usage = members.reduce((sum, member) => sum + member.usage, 0);
    return { id: entityName, label: entityName, usage, usageValue: usageValue(usage, data), messages: members.reduce((sum, member) => sum + member.messages, 0), activeUsers: members.filter((member) => member.usage > 0).length, memberCount: members.length };
  }).filter((row) => row.memberCount > 0);
  return {
    startDate, endDate, bucket, groupId: null, entity: null, unit: data.usageUnit,
    source: data.usageSource, settings: data.settings, valuationCoverage: totalValue === null ? "unavailable" : "complete",
    totals: { usage: totalUsage, usageValue: totalValue, messages: memberRows.reduce((sum, row) => sum + row.messages, 0), activeUsers, totalMembers: data.members.length, averageUsagePerActive: activeUsers ? totalUsage / activeUsers : 0, averageUsageValuePerActive: totalValue === null ? null : totalValue / Math.max(activeUsers, 1) },
    series: data.trend.map((point, index) => ({ key: `demo-${index}`, label: point.label, periodStart: startDate, periodEnd: endDate, usage: point.credits, usageValue: usageValue(point.credits, data), messages: 0, activeUsers: 0 })),
    byEntity,
    byGroup: data.groups.map((group) => ({ id: group.id, label: group.name, sublabel: group.description, usage: group.usage, usageValue: usageValue(group.usage, data), messages: 0, activeUsers: group.activeMembers, memberCount: group.memberCount })).sort((a, b) => b.usage - a.usage),
    byUser: memberRows.sort((a, b) => b.usage - a.usage), warning: null,
  };
}

export default function CodexlensApp({ initialView = "overview", forceDemo = false }: { initialView?: View; forceDemo?: boolean }) {
  const [data, setData] = useState<DashboardData>(demoData);
  const [view, setView] = useState<View>(initialView);
  const [entity, setEntity] = useState<EntityFilter>("All");
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importingUsage, setImportingUsage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (forceDemo) return;
    let cancelled = false;
    fetch("/api/dashboard")
      .then((response) => response.ok ? response.json() as Promise<DashboardData> : Promise.reject(new Error("No saved data")))
      .then((payload: DashboardData) => { if (!cancelled) setData(payload); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [forceDemo]);

  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.members.filter((member) => {
      const matchesEntity = entity === "All" || member.entity === entity;
      const matchesQuery = !normalized || [member.name, member.email, member.peopleRole ?? "", member.department ?? "", ...member.groups].join(" ").toLowerCase().includes(normalized);
      return matchesEntity && matchesQuery;
    }).sort((a, b) => Number(b.peopleMatch === "Missing") - Number(a.peopleMatch === "Missing") || a.name.localeCompare(b.name));
  }, [data.members, entity, query]);

  const unreadChanges = data.changes.filter((change) => change.unread).length;

  async function syncWorkspace() {
    setSyncing(true); setNotice(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const payload = await response.json() as {
        error?: string;
        dashboard: DashboardData;
        changesCreated: number;
        sync?: { directory: { members: number; groups: number }; usageHistory: { updated: boolean; imported: number; unmatched: number; message: string } };
      };
      if (!response.ok) throw new Error(payload.error || "Sync failed");
      setData(payload.dashboard);
      const counts = payload.sync?.directory;
      const usageMessage = payload.sync?.usageHistory.message ?? "Usage sync status was not returned.";
      setNotice(`Directory synced${counts ? ` — ${counts.members} members, ${counts.groups} groups` : ""}; ${payload.changesCreated} changes detected. ${usageMessage}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Sync failed"); }
    finally { setSyncing(false); }
  }

  async function importUsageFile(file: File) {
    setImportingUsage(true); setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file); form.set("source", "Admin Console CSV");
      const response = await fetch("/api/usage-import", { method: "POST", body: form });
      const payload = await response.json() as { error?: string; dashboard?: DashboardData; imported: number; unmatched: number };
      if (!response.ok) throw new Error(payload.error || "Usage import failed");
      if (payload.dashboard) setData(payload.dashboard);
      setNotice(`Imported ${payload.imported} usage rows${payload.unmatched ? `; ${payload.unmatched} emails were not matched` : ""}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Usage import failed"); }
    finally { setImportingUsage(false); }
  }

  async function markChangesRead() {
    const response = await fetch("/api/changes-read", { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setNotice(payload.error || "Could not mark changes as read."); return;
    }
    setData((current) => ({ ...current, changes: current.changes.map((change) => ({ ...change, unread: false })) }));
  }

  async function refreshDashboard() {
    const response = await fetch("/api/dashboard");
    const payload = await response.json() as DashboardData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Could not refresh the saved workspace.");
    setData(payload);
  }

  function navigate(nextView: View) {
    setView(nextView); setMobileNavOpen(false);
  }

  function updateSettings(settings: AppSettings) {
    setData((current) => ({ ...current, settings }));
    setNotice(settings.pricePerCredit === null ? "Credit valuation cleared." : `Usage value and estimated overage invoice now use ${settings.pricePerCredit} ${settings.currency} per credit.`);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar${mobileNavOpen ? " sidebar--open" : ""}`}>
        <div className="brand-row"><BubbleLogo /><div><strong>codexlens</strong><span>workspace intelligence</span></div><button className="icon-button sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={17} /></button></div>
        <a className="workspace-switcher" href="https://admin.openai.com/" target="_blank" rel="noreferrer"><span className="workspace-avatar">A</span><span><strong>{data.workspaceName}</strong><small>ChatGPT workspace</small></span><ChevronDown size={15} /></a>
        <nav className="main-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => { const Icon = item.icon; const badge = item.id === "members" ? data.members.length : item.id === "changes" ? unreadChanges : undefined; return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{badge !== undefined && <em>{badge}</em>}</button>; })}
        </nav>
        <div className="entity-legend"><p className="nav-label">Entities</p>{(["Allegro", "eBilet", "Ceneo"] as Entity[]).map((name) => { const count = data.members.filter((member) => member.entity === name).length; return <button key={name} onClick={() => { setEntity(name); navigate("members"); }}><i style={{ background: entityColors[name] }} /><span>{name}</span><em>{count}</em></button>; })}</div>
        <div className="sidebar-footer"><button onClick={() => setSettingsOpen(true)}><Settings size={17} /><span>Settings</span></button><div className="identity-row"><span className="avatar avatar--small">MK</span><span><strong>Workspace admin</strong><small>Local session</small></span><MoreHorizontal size={17} /></div></div>
      </aside>

      {mobileNavOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <section className="workspace">
        <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={18} /></button><span>Members, groups & roles</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === view)?.label}</strong></div><div className="topbar-actions"><span className={`source-status source-status--${data.mode}`}><i />{sourceLabel(data)}</span><button className="icon-button" aria-label="Notifications" onClick={() => navigate("changes")}><Bell size={17} />{unreadChanges > 0 && <i className="notification-dot" />}</button><button className="button button--primary" onClick={syncWorkspace} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{syncing ? "Syncing" : "Sync directory"}</button></div></header>
        {notice && <div className="notice-bar"><Activity size={15} /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button></div>}

        {view === "overview" && <Overview key={`${data.mode}:${data.settings.billingPeriodStart}:${data.settings.billingPeriodEnd}`} data={data} importingUsage={importingUsage} onImportUsage={importUsageFile} onOpenSettings={() => setSettingsOpen(true)} onViewAnalytics={() => navigate("analytics")} onViewMembers={() => navigate("members")} onViewChanges={() => navigate("changes")} />}
        {view === "analytics" && <AnalyticsView data={data} importingUsage={importingUsage} onImportUsage={importUsageFile} onOpenSettings={() => setSettingsOpen(true)} />}
        {view === "management" && <ManagementCostView data={data} onOpenSettings={() => setSettingsOpen(true)} />}
        {view === "members" && <MembersView data={data} members={filteredMembers} totalMembers={data.members.length} entity={entity} query={query} onEntityChange={setEntity} onQueryChange={setQuery} onSelectMember={setSelectedMember} />}
        {view === "organize" && <OrganizerView data={data} onSelectMember={setSelectedMember} onRefresh={refreshDashboard} onNotice={setNotice} />}
        {view === "changes" && <ChangesView changes={data.changes} onSelectMember={(id) => { const member = data.members.find((item) => item.id === id); if (member) setSelectedMember(member); }} onMarkRead={markChangesRead} />}
      </section>

      {selectedMember && <MemberDrawer member={selectedMember} groups={data.groups} data={data} onClose={() => setSelectedMember(null)} />}
      {settingsOpen && <SettingsDrawer settings={data.settings} usageUnit={data.usageUnit} onClose={() => setSettingsOpen(false)} onSaved={updateSettings} />}
    </main>
  );
}

function PageIntro({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function MetricCard({ label, value, note, action, onClick, icon }: { label: string; value: string; note: string; action?: string; onClick?: () => void; icon: React.ReactNode }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong className="metric-value">{value}</strong><div className="metric-bottom"><span>{note}</span>{action && <button onClick={onClick}>{action}<ChevronRight size={13} /></button>}</div></article>;
}

function Overview({ data, importingUsage, onImportUsage, onOpenSettings, onViewAnalytics, onViewMembers, onViewChanges }: {
  data: DashboardData;
  importingUsage: boolean;
  onImportUsage: (file: File) => void;
  onOpenSettings: () => void;
  onViewAnalytics: () => void;
  onViewMembers: () => void;
  onViewChanges: () => void;
}) {
  const defaultEnd = data.mode !== "demo" && data.settings.billingPeriodEnd ? data.settings.billingPeriodEnd : todayIso();
  const defaultStart = data.mode !== "demo" && data.settings.billingPeriodStart ? data.settings.billingPeriodStart : daysBefore(defaultEnd, 29);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [remoteAnalytics, setRemoteAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDays = Math.max(1, Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000) + 1);
  const overviewBucket: AnalyticsBucket = selectedDays <= 14 ? "day" : selectedDays <= 120 ? "week" : "month";
  const analytics = data.mode === "demo" ? illustrativeAnalytics(data, startDate, endDate, overviewBucket) : remoteAnalytics;

  useEffect(() => {
    if (data.mode === "demo") return;
    const controller = new AbortController();
    const params = new URLSearchParams({ start: startDate, end: endDate, bucket: overviewBucket });
    fetch(`/api/analytics?${params}`, { signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as AnalyticsData & { error?: string }; if (!response.ok) throw new Error(payload.error || "Overview analytics could not be loaded."); return payload; })
      .then((payload) => { setRemoteAnalytics(payload); setError(null); })
      .catch((reason) => { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [data.lastSyncedAt, data.mode, data.settings.pricePerCredit, endDate, overviewBucket, startDate]);

  function setRange(start: string, end: string) { setStartDate(start); setEndDate(end); }
  function preset(days: number) { const end = todayIso(); setRange(daysBefore(end, days - 1), end); }
  function useBillingPeriod() {
    if (data.settings.billingPeriodStart && data.settings.billingPeriodEnd) setRange(data.settings.billingPeriodStart, data.settings.billingPeriodEnd);
    else onOpenSettings();
  }

  const totalUsage = analytics?.totals.usage ?? 0;
  const totalValue = analytics?.totals.usageValue ?? null;
  const activeUsers = analytics?.totals.activeUsers ?? 0;
  const invoiceMatchesPeriod = startDate === data.settings.billingPeriodStart && endDate === data.settings.billingPeriodEnd;
  const invoiceEstimate = invoiceMatchesPeriod ? estimatedInvoice(data.settings) : null;
  const periodLabel = `${startDate} – ${endDate}`;
  const loading = !analytics || analytics.startDate !== startDate || analytics.endDate !== endDate || analytics.bucket !== overviewBucket;
  const series = analytics?.series ?? [];
  const maxTrend = Math.max(...series.map((point) => point.usage), 1);
  const groupDetails = new Map(data.groups.map((group) => [group.id, group]));
  const entityStats = (["Allegro", "eBilet", "Ceneo"] as Entity[]).map((entityName) => {
    const row = analytics?.byEntity.find((item) => item.id === entityName);
    return { entity: entityName, members: data.members.filter((member) => member.entity === entityName).length, usage: row?.usage ?? 0, value: row?.usageValue ?? (analytics?.valuationCoverage === "complete" ? 0 : null) };
  });

  return <div className="page-content">
    <PageIntro eyebrow="Workspace overview" title="See the shape of your workspace." description={`All usage, value, and activity metrics below use ${periodLabel}. Current directory counts and changes since sync are labeled separately.`} actions={<><label className={`button button--secondary file-button${importingUsage ? " disabled" : ""}`}>{importingUsage ? <LoaderCircle className="spin" size={16} /> : <FileUp size={16} />}{importingUsage ? "Importing" : "Import usage CSV"}<input type="file" accept=".csv,text/csv" disabled={importingUsage} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportUsage(file); event.target.value = ""; }} /></label><a className="button button--secondary" href="/api/export"><Download size={16} />Export report</a></>} />
    <section className="analytics-controls overview-controls panel"><div className="preset-buttons"><button onClick={() => preset(7)}>7D</button><button onClick={() => preset(30)}>30D</button><button onClick={() => preset(90)}>90D</button><button onClick={useBillingPeriod}>Billing</button></div><label><span>From</span><input type="date" value={startDate} max={endDate} onChange={(event) => setRange(event.target.value, endDate)} /></label><label><span>To</span><input type="date" value={endDate} min={startDate} onChange={(event) => setRange(startDate, event.target.value)} /></label><div className="overview-period-note"><CalendarDays size={16} /><span><strong>{periodLabel}</strong><small>All Overview usage data uses this period</small></span></div></section>
    {error && <div className="analytics-warning analytics-warning--error"><Activity size={16} />{error}</div>}
    {loading && <div className="overview-loading"><LoaderCircle className="spin" size={14} />Updating period</div>}
    {data.mode === "demo" && <div className="data-banner"><span className="status-mark"><Command size={15} /></span><div><strong>Previewing the codexlens experience</strong><p>Illustrative values are replaced by saved API data after your first sync.</p></div><span className="source-chip">{data.usageSource}</span></div>}
    {data.mode !== "demo" && !loading && totalUsage === 0 && <div className="data-banner data-banner--attention"><span className="status-mark"><BarChart3 size={15} /></span><div><strong>No attributed usage for {periodLabel}</strong><p>Choose another period, run sync, or import attributed history in Analytics.</p></div><button className="button button--secondary" onClick={onViewAnalytics}>Open Analytics</button></div>}
    {data.usageUnit === "credits" && data.settings.pricePerCredit === null && <button className="pricing-banner" onClick={onOpenSettings}><CircleDollarSign size={17} /><span><strong>Add your contract price per credit</strong><small>Codexlens will calculate usage value for every person, group, entity, and period.</small></span><ChevronRight size={16} /></button>}
    <section className="metric-grid">
      <MetricCard label={`Workspace ${analytics?.unit ?? data.usageUnit}`} value={formatNumber(totalUsage)} note={periodLabel} icon={<Activity size={18} />} />
      <MetricCard label="Usage value" value={formatMoney(totalValue, analytics?.settings.currency ?? costCurrency(data))} note={`${periodLabel} · not an invoice`} action={totalValue === null ? "Configure" : undefined} onClick={onOpenSettings} icon={<CircleDollarSign size={18} />} />
      <MetricCard label="Estimated invoice" value={invoiceEstimate === null ? "No matching snapshot" : formatMoney(invoiceEstimate, data.settings.currency)} note={invoiceMatchesPeriod ? "Billing overage for selected period" : `Available for ${billingPeriodLabel(data.settings)}`} action={invoiceMatchesPeriod ? "Review" : "Use period"} onClick={invoiceMatchesPeriod ? onOpenSettings : useBillingPeriod} icon={<CalendarDays size={18} />} />
      <MetricCard label="Active users" value={formatNumber(activeUsers)} note={periodLabel} icon={<Users size={18} />} />
      <MetricCard label="Average per active user" value={formatNumber(analytics?.totals.averageUsagePerActive ?? 0)} note={`${formatMoney(analytics?.totals.averageUsageValuePerActive ?? null, analytics?.settings.currency ?? data.settings.currency)} average value`} icon={<BarChart3 size={18} />} />
    </section>
    <section className="overview-grid">
      <article className="panel usage-panel"><div className="panel-heading"><div><span className="eyebrow">Usage & value trend</span><h2>{periodLabel}</h2></div><button className="text-button" onClick={onViewAnalytics}>Full analytics <ChevronRight size={14} /></button></div><div className="chart-wrap"><div className="chart-scale"><span>{formatNumber(maxTrend)}</span><span>{formatNumber(maxTrend / 2)}</span><span>0</span></div><div className="bar-chart" style={{ gridTemplateColumns: `repeat(${Math.max(series.length, 1)}, 1fr)` }} role="img" aria-label={`Usage trend for ${periodLabel}`}>{series.map((point, index) => <div className="bar-column" key={point.key}><div className="bar-track"><span style={{ height: `${point.usage === 0 ? 2 : Math.max(10, (point.usage / maxTrend) * 100)}%` }}><i>{formatNumber(point.usage)} · {formatMoney(point.usageValue, analytics?.settings.currency ?? data.settings.currency)}</i></span></div>{(index === 0 || index === series.length - 1 || index % Math.max(1, Math.ceil(series.length / 6)) === 0) && <small>{point.label}</small>}</div>)}</div></div><div className="chart-footnote"><span><i />{analytics?.unit ?? data.usageUnit} · usage value</span><p>Source: {analytics?.source ?? data.usageSource}</p></div></article>
      <article className="panel change-preview"><div className="panel-heading"><div><span className="eyebrow">Since the last sync</span><h2>What changed</h2></div><button className="text-button" onClick={onViewChanges}>View all <ChevronRight size={14} /></button></div><div className="change-list">{data.changes.slice(0, 4).map((change) => <ChangeRow key={change.id} change={change} />)}</div></article>
    </section>
    <section className="entity-section"><div className="section-heading"><div><span className="eyebrow">Company view · {periodLabel}</span><h2>Usage by entity</h2></div><button className="text-button" onClick={onViewMembers}>Explore members <ChevronRight size={14} /></button></div><div className="entity-grid">{entityStats.map(({ entity, members, usage, value }) => <button className="entity-card" key={entity} onClick={onViewMembers}><span className="entity-symbol" style={{ color: entityColors[entity] }}><Building2 size={18} /></span><span><strong>{entity}</strong><small>{members} current people</small></span><span className="entity-usage"><strong>{formatNumber(usage)}</strong><small>{formatMoney(value, analytics?.settings.currency ?? data.settings.currency)}</small></span><ChevronRight size={17} /></button>)}</div></section>
    <section className="panel group-summary"><div className="panel-heading"><div><span className="eyebrow">Access structure · {periodLabel}</span><h2>Group usage</h2></div><button className="text-button" onClick={onViewAnalytics}>See all groups <ChevronRight size={14} /></button></div><div className="table-scroll"><table><thead><tr><th>Group</th><th>Source</th><th>Current members</th><th>Active in period</th><th>Usage</th><th>Usage value</th><th>Avg value / active</th><th /></tr></thead><tbody>{(analytics?.byGroup ?? []).slice(0, 6).map((row) => { const group = groupDetails.get(row.id); return <tr key={row.id} onClick={onViewAnalytics}><td>{group ? <span className={`group-orb group-orb--${group.accent}`}><BubbleLogo compact /></span> : <span className="group-orb group-orb--slate"><BubbleLogo compact /></span>}<span><strong>{row.label}</strong><small>{row.sublabel ?? group?.description ?? "Current membership"}</small></span></td><td><span className={`pill ${group?.source === "SCIM" ? "pill--neutral" : "pill--green"}`}>{group?.source ?? "—"}</span></td><td>{row.memberCount}</td><td>{row.activeUsers}</td><td>{formatNumber(row.usage)}</td><td>{formatMoney(row.usageValue, analytics?.settings.currency ?? data.settings.currency)}</td><td>{formatMoney(row.usageValue === null ? null : row.usageValue / Math.max(row.activeUsers, 1), analytics?.settings.currency ?? data.settings.currency)}</td><td><ChevronRight size={15} /></td></tr>; })}</tbody></table></div></section>
  </div>;
}

function AnalyticsView({ data, importingUsage, onImportUsage, onOpenSettings }: {
  data: DashboardData;
  importingUsage: boolean;
  onImportUsage: (file: File) => void;
  onOpenSettings: () => void;
}) {
  const defaultEnd = todayIso();
  const [startDate, setStartDate] = useState(daysBefore(defaultEnd, 29));
  const [endDate, setEndDate] = useState(defaultEnd);
  const [bucket, setBucket] = useState<AnalyticsBucket>("day");
  const [groupId, setGroupId] = useState("");
  const [entity, setEntity] = useState("");
  const [tab, setTab] = useState<AnalyticsTab>("groups");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [previousAnalytics, setPreviousAnalytics] = useState<AnalyticsData | null>(null);
  const [billingAnalytics, setBillingAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const prior = previousPeriod(startDate, endDate);
    const analyticsRequest = async (rangeStart: string, rangeEnd: string) => {
      const params = new URLSearchParams({ start: rangeStart, end: rangeEnd, bucket });
      if (groupId) params.set("group", groupId);
      if (entity) params.set("entity", entity);
      const response = await fetch(`/api/analytics?${params}`, { signal: controller.signal });
      const payload = await response.json() as AnalyticsData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Analytics could not be loaded.");
      return payload;
    };
    Promise.all([analyticsRequest(startDate, endDate), analyticsRequest(prior.startDate, prior.endDate)])
      .then(([current, previous]) => { setError(null); setAnalytics(current); setPreviousAnalytics(previous); })
      .catch((reason) => { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [startDate, endDate, bucket, groupId, entity, data.lastSyncedAt, data.settings.pricePerCredit]);

  useEffect(() => {
    if (!data.settings.billingPeriodStart || !data.settings.billingPeriodEnd) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ start: data.settings.billingPeriodStart, end: data.settings.billingPeriodEnd, bucket: "month" });
    fetch(`/api/analytics?${params}`, { signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as AnalyticsData & { error?: string }; if (!response.ok) throw new Error(payload.error || "Billing reference usage could not be loaded."); return payload; })
      .then(setBillingAnalytics)
      .catch((reason) => { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [data.lastSyncedAt, data.settings.billingPeriodEnd, data.settings.billingPeriodStart]);

  function preset(days: number) { const end = todayIso(); setEndDate(end); setStartDate(daysBefore(end, days - 1)); }
  function useBillingRange() {
    if (data.settings.billingPeriodStart && data.settings.billingPeriodEnd) {
      setStartDate(data.settings.billingPeriodStart); setEndDate(data.settings.billingPeriodEnd); setGroupId(""); setEntity("");
    } else onOpenSettings();
  }
  const rows = analytics ? tab === "groups" ? analytics.byGroup : tab === "entities" ? analytics.byEntity : analytics.byUser : [];
  const allocationModel = invoiceAllocationModel(data.settings, billingAnalytics);
  const invoiceRate = analytics?.unit === "usd" ? 1 : analytics?.unit === "credits" && allocationModel ? allocationModel.estimatedCostPerUsageCredit : null;
  const previousInvoiceRate = previousAnalytics?.unit === "usd" ? 1 : previousAnalytics?.unit === "credits" && allocationModel ? allocationModel.estimatedCostPerUsageCredit : null;
  const selectedInvoiceEstimate = analytics && invoiceRate !== null ? analytics.totals.usage * invoiceRate : null;
  const previousInvoiceEstimate = previousAnalytics && previousInvoiceRate !== null ? previousAnalytics.totals.usage * previousInvoiceRate : null;
  const costBasis = analytics?.unit === "usd" ? "Reported cost" : invoiceRate !== null ? "Estimated invoice" : "Billing cost";
  const selectedScope = [groupId ? data.groups.find((group) => group.id === groupId)?.name ?? "Selected group" : null, entity || null].filter(Boolean).join(" · ") || "All workspace members";
  const filtered = Boolean(groupId || entity);
  const selectionDays = inclusiveDays(startDate, endDate);
  const currentDay = todayIso();
  const elapsedDays = startDate > currentDay ? 0 : inclusiveDays(startDate, endDate < currentDay ? endDate : currentDay);
  const isOpenPeriod = startDate <= currentDay && endDate > currentDay;
  const projectedInvoice = selectedInvoiceEstimate === null || elapsedDays === 0
    ? null
    : isOpenPeriod ? selectedInvoiceEstimate / elapsedDays * selectionDays : selectedInvoiceEstimate;
  const dailyBurn = selectedInvoiceEstimate === null || elapsedDays === 0 ? null : selectedInvoiceEstimate / elapsedDays;
  const budgetReferenceDays = data.settings.billingPeriodStart && data.settings.billingPeriodEnd
    ? inclusiveDays(data.settings.billingPeriodStart, data.settings.billingPeriodEnd)
    : 30;
  const selectedBudget = !filtered && data.settings.billingBudgetAmount !== null && data.settings.billingBudgetAmount > 0
    ? data.settings.billingBudgetAmount * selectionDays / budgetReferenceDays
    : null;
  const budgetUtilization = selectedBudget && projectedInvoice !== null ? projectedInvoice / selectedBudget : null;
  const budgetVariance = selectedBudget !== null && projectedInvoice !== null ? selectedBudget - projectedInvoice : null;
  const priorDelta = percentDelta(selectedInvoiceEstimate, previousInvoiceEstimate);
  const previousRange = previousPeriod(startDate, endDate);
  const scopedGroupName = groupId ? data.groups.find((group) => group.id === groupId)?.name : null;
  const scopedMembers = data.members.filter((member) => (!entity || member.entity === entity) && (!scopedGroupName || member.groups.includes(scopedGroupName)));
  const ungroupedMembers = scopedMembers.filter((member) => member.groups.length === 0).length;
  const missingProfiles = scopedMembers.filter((member) => member.peopleMatch !== "Matched").length;
  const directoryExceptions = scopedMembers.filter((member) => member.groups.length === 0 || member.peopleMatch !== "Matched").length;
  const adoptionRate = analytics?.totals.totalMembers ? analytics.totals.activeUsers / analytics.totals.totalMembers : 0;
  const topTenShare = analytics?.totals.usage
    ? analytics.byUser.slice(0, 10).reduce((sum, row) => sum + row.usage, 0) / analytics.totals.usage
    : 0;
  const userCosts = invoiceRate === null || !analytics ? [] : analytics.byUser.filter((row) => row.usage > 0).map((row) => row.usage * invoiceRate);
  const medianUserCost = percentile(userCosts, 0.5);
  const p90UserCost = percentile(userCosts, 0.9);
  const topGroup = analytics?.byGroup.find((row) => row.id !== "__unassigned__");
  const topEntity = analytics?.byEntity[0];
  const syncAgeHours = data.lastSyncedAt ? Math.max(0, (new Date(`${currentDay}T00:00:00Z`).getTime() - new Date(data.lastSyncedAt).getTime()) / 3_600_000) : null;
  const budgetTone = budgetUtilization === null ? "neutral" : budgetUtilization >= 1 ? "danger" : budgetUtilization * 100 >= data.settings.budgetAlertPercent ? "warning" : "good";
  const signals: Array<{ tone: "good" | "warning" | "danger" | "neutral"; title: string; detail: string }> = [];
  if (filtered) signals.push({ tone: "neutral", title: "Filtered contribution view", detail: "Workspace budget is intentionally not allocated to this group/entity scope." });
  else if (selectedBudget === null) signals.push({ tone: "warning", title: "Budget target missing", detail: "Set a billing-cycle budget to see utilization, headroom, and alerts." });
  else if (budgetUtilization !== null && budgetUtilization >= 1) signals.push({ tone: "danger", title: "Forecast above target", detail: `${formatMoney(Math.abs(budgetVariance ?? 0), analytics?.settings.currency ?? data.settings.currency)} over the prorated target.` });
  else if (budgetUtilization !== null && budgetUtilization * 100 >= data.settings.budgetAlertPercent) signals.push({ tone: "warning", title: "Budget alert threshold reached", detail: `${(budgetUtilization * 100).toFixed(1)}% of the prorated target at the current pace.` });
  else if (budgetUtilization !== null) signals.push({ tone: "good", title: "Spend pace within target", detail: `${(budgetUtilization * 100).toFixed(1)}% of the prorated target at the current pace.` });
  if (priorDelta !== null && priorDelta > 0.2) signals.push({ tone: "warning", title: "Cost accelerated", detail: `${(priorDelta * 100).toFixed(1)}% above the preceding ${selectionDays}-day period.` });
  else if (priorDelta !== null && priorDelta <= 0) signals.push({ tone: "good", title: "Cost stable or lower", detail: `${Math.abs(priorDelta * 100).toFixed(1)}% below the preceding ${selectionDays}-day period.` });
  if (topTenShare > 0.6) signals.push({ tone: "warning", title: "Usage is concentrated", detail: `Top 10 active members account for ${(topTenShare * 100).toFixed(1)}% of selected usage.` });
  if (ungroupedMembers > 0) signals.push({ tone: "warning", title: `${ungroupedMembers} members are ungrouped`, detail: "Their usage is visible but lacks a management allocation." });
  if (missingProfiles > 0) signals.push({ tone: "neutral", title: `${missingProfiles} People API profiles need review`, detail: "Role and entity reporting may be incomplete for these members." });
  if (syncAgeHours !== null && syncAgeHours > 24) signals.push({ tone: "warning", title: "Data may be stale", detail: `Last directory sync was ${Math.floor(syncAgeHours)} hours ago.` });
  return <div className="page-content analytics-page">
    <PageIntro eyebrow="Budget intelligence" title="Analytics" description="Control spend with period forecasts, budget variance, concentration, and accountable group, entity, and member views." actions={<><label className={`button button--secondary file-button${importingUsage ? " disabled" : ""}`}>{importingUsage ? <LoaderCircle className="spin" size={16} /> : <FileUp size={16} />}{importingUsage ? "Importing" : "Import history"}<input type="file" accept=".csv,text/csv" disabled={importingUsage} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportUsage(file); event.target.value = ""; }} /></label><button className="button button--secondary" onClick={onOpenSettings}><Settings size={16} />Budget & billing</button></>} />
    <section className="analytics-controls panel">
      <div className="preset-buttons"><button onClick={() => preset(7)}>7D</button><button onClick={() => preset(30)}>30D</button><button onClick={() => preset(90)}>90D</button><button onClick={() => { const end = todayIso(); setEndDate(end); setStartDate(end.slice(0, 8) + "01"); }}>MTD</button></div>
      <label><span>From</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <label><span>Group</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">All groups</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label><span>Entity</span><select value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">All entities</option>{(["Allegro", "eBilet", "Ceneo", "Unknown"] as Entity[]).map((name) => <option key={name}>{name}</option>)}</select></label>
      <div className="bucket-control"><span>Interval</span><div className="segmented-filter">{(["day", "week", "month"] as AnalyticsBucket[]).map((value) => <button key={value} className={bucket === value ? "active" : ""} onClick={() => setBucket(value)}>{value === "day" ? "Daily" : value === "week" ? "Weekly" : "Monthly"}</button>)}</div></div>
    </section>
    {error && <div className="analytics-warning analytics-warning--error"><Activity size={16} />{error}</div>}
    {analytics?.warning && <div className="analytics-warning"><CalendarDays size={16} />{analytics.warning}</div>}
    {loading && !analytics ? <div className="analytics-loading"><LoaderCircle className="spin" size={22} />Loading analytics</div> : analytics && <>
      {analytics.totals.usage === 0 && <div className="history-empty-banner"><span className="history-empty-icon"><FileUp size={18} /></span><div><strong>No historical usage has been loaded</strong><p>Run Sync directory with an Admin key that has Codex analytics API: Read. CSV import remains available as a fallback for attributed history.</p></div><label className={`button button--primary file-button${importingUsage ? " disabled" : ""}`}>{importingUsage ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />}{importingUsage ? "Importing" : "Import CSV"}<input type="file" accept=".csv,text/csv" disabled={importingUsage} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportUsage(file); event.target.value = ""; }} /></label></div>}
      <section className="analytics-kpis">
        <MetricCard label={`${costBasis} · selection`} value={selectedInvoiceEstimate === null ? "Unavailable" : formatMoney(selectedInvoiceEstimate, analytics.settings.currency)} note={`${analytics.startDate} – ${analytics.endDate} · ${selectedScope}`} action="Use billing period" onClick={useBillingRange} icon={<CircleDollarSign size={18} />} />
        <MetricCard label="Period-end forecast" value={projectedInvoice === null ? "Unavailable" : formatMoney(projectedInvoice, analytics.settings.currency)} note={isOpenPeriod ? `${elapsedDays} of ${selectionDays} days elapsed` : "Completed selection · equals period cost"} icon={<Gauge size={18} />} />
        <MetricCard label="Budget utilization" value={filtered ? "Workspace only" : budgetUtilization === null ? "Not set" : `${(budgetUtilization * 100).toFixed(1)}%`} note={filtered ? "Remove filters for workspace target" : selectedBudget === null ? "Configure billing-cycle budget" : `${formatMoney(selectedBudget, analytics.settings.currency)} prorated target`} action={selectedBudget === null && !filtered ? "Configure" : undefined} onClick={onOpenSettings} icon={<ShieldCheck size={18} />} />
        <MetricCard label="Vs previous period" value={priorDelta === null ? "No baseline" : `${priorDelta > 0 ? "+" : ""}${(priorDelta * 100).toFixed(1)}%`} note={`${previousRange.startDate} – ${previousRange.endDate}`} icon={priorDelta !== null && priorDelta > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />} />
        <MetricCard label={`${analytics.unit} used`} value={formatNumber(analytics.totals.usage)} note={`${formatNumber(analytics.totals.messages)} turns · ${analytics.source}`} icon={<Activity size={18} />} />
        <MetricCard label="Active adoption" value={`${(adoptionRate * 100).toFixed(1)}%`} note={`${analytics.totals.activeUsers} of ${analytics.totals.totalMembers} scoped members`} icon={<Users size={18} />} />
        <MetricCard label="Avg cost / active" value={selectedInvoiceEstimate === null ? "Unavailable" : formatMoney(selectedInvoiceEstimate / Math.max(analytics.totals.activeUsers, 1), analytics.settings.currency)} note={`${formatNumber(analytics.totals.averageUsagePerActive)} ${analytics.unit} / active`} icon={<BarChart3 size={18} />} />
        <MetricCard label="Daily burn" value={formatMoney(dailyBurn, analytics.settings.currency)} note={`${elapsedDays || selectionDays} observed days · ${costBasis.toLowerCase()}`} icon={<CalendarDays size={18} />} />
      </section>
      <section className="budget-command-grid">
        <article className={`panel budget-position budget-position--${budgetTone}`}><div className="panel-heading"><div><span className="eyebrow">Budget position</span><h2>{filtered ? "Scoped contribution" : "Workspace forecast"}</h2></div><span className={`budget-status budget-status--${budgetTone}`}>{budgetTone === "danger" ? "Over target" : budgetTone === "warning" ? "Needs attention" : budgetTone === "good" ? "On track" : "Target needed"}</span></div>{selectedBudget !== null && projectedInvoice !== null ? <><div className="budget-progress-copy"><strong>{formatMoney(projectedInvoice, analytics.settings.currency)}</strong><span>forecast of {formatMoney(selectedBudget, analytics.settings.currency)}</span></div><div className="budget-progress" role="progressbar" aria-label="Budget utilization" aria-valuenow={Math.round((budgetUtilization ?? 0) * 100)}><span style={{ width: `${Math.min(100, Math.max(0, (budgetUtilization ?? 0) * 100))}%` }} /></div><div className="budget-position-stats"><span><small>Selected cost</small><strong>{formatMoney(selectedInvoiceEstimate, analytics.settings.currency)}</strong></span><span><small>{budgetVariance !== null && budgetVariance < 0 ? "Over target" : "Headroom"}</small><strong>{formatMoney(budgetVariance === null ? null : Math.abs(budgetVariance), analytics.settings.currency)}</strong></span><span><small>Alert threshold</small><strong>{data.settings.budgetAlertPercent}%</strong></span></div></> : <div className="budget-empty"><CircleDollarSign size={22} /><div><strong>{filtered ? "Budget stays at workspace level" : "Add a billing-cycle budget"}</strong><p>{filtered ? "Use this scope to understand contribution, then remove filters to assess the workspace target." : "Codexlens will prorate it to the selected period and flag forecast variance."}</p></div>{!filtered && <button className="button button--secondary" onClick={onOpenSettings}>Configure</button>}</div>}</article>
        <article className="panel budget-signals"><div className="panel-heading"><div><span className="eyebrow">Attention queue</span><h2>Budget signals</h2></div><span className="source-chip">{signals.filter((signal) => signal.tone === "danger" || signal.tone === "warning").length} to review</span></div><div className="signal-list">{signals.slice(0, 5).map((signal, index) => <div className={`signal-row signal-row--${signal.tone}`} key={`${signal.title}-${index}`}><span>{signal.tone === "danger" || signal.tone === "warning" ? <AlertTriangle size={15} /> : <Check size={15} />}</span><div><strong>{signal.title}</strong><small>{signal.detail}</small></div></div>)}{signals.length === 0 && <div className="budget-empty"><Check size={22} /><div><strong>No budget exceptions</strong><p>The selected scope has no material alerts.</p></div></div>}</div></article>
      </section>
      <section className="panel finance-stat-strip"><span><small>Top 10 usage share</small><strong>{(topTenShare * 100).toFixed(1)}%</strong></span><span><small>Median active user</small><strong>{formatMoney(medianUserCost, analytics.settings.currency)}</strong></span><span><small>P90 active user</small><strong>{formatMoney(p90UserCost, analytics.settings.currency)}</strong></span><span><small>Top group</small><strong>{topGroup?.label ?? "—"}</strong></span><span><small>Top entity</small><strong>{topEntity?.label ?? "—"}</strong></span><span><small>Directory exceptions</small><strong>{directoryExceptions}</strong><em>{ungroupedMembers} ungrouped · {missingProfiles} profiles</em></span></section>
      <BillingSnapshot settings={analytics.settings} onOpenSettings={onOpenSettings} />
      <section className="panel billing-allocation"><div className="panel-heading"><div><span className="eyebrow">Selected period estimate</span><h2>Invoice allocation model</h2></div><span className="source-chip">{allocationModel ? allocationModel.referencePeriod : "Billing basis unavailable"}</span></div>{allocationModel ? <><p className="table-note">The selected estimate applies the observed billing-period overage share to the selected credits. It is an analytical allocation, not an issued invoice.</p><div className="billing-snapshot-grid"><span><small>Selected estimate</small><strong>{selectedInvoiceEstimate === null ? "Unavailable" : formatMoney(selectedInvoiceEstimate, data.settings.currency)}</strong></span><span><small>Reference invoice</small><strong>{formatMoney(allocationModel.referenceInvoice, data.settings.currency)}</strong></span><span><small>Reference usage</small><strong>{formatNumber(allocationModel.referenceUsage)} credits</strong></span><span><small>Calibrated overage share</small><strong>{(allocationModel.overageShare * 100).toFixed(1)}%</strong></span></div></> : <div className="empty-state"><CircleDollarSign size={22} /><strong>Invoice allocation unavailable</strong><p>Add a billing period, unbilled overage, price per credit, and usage for that reference period.</p></div>}</section>
      <AnalyticsTrend analytics={analytics} invoiceRate={invoiceRate} />
      <section className="panel analytics-breakdown">
        <div className="panel-heading"><div><span className="eyebrow">Breakdown</span><h2>Where usage goes</h2></div><div className="analytics-tabs">{(["users", "groups", "entities"] as AnalyticsTab[]).map((value) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>By {value}</button>)}</div></div>
        {tab === "groups" && <p className="table-note">Group estimates use the calibrated overage share from {allocationModel?.referencePeriod ?? "the saved billing period"}. Historical usage uses current membership; groups overlap, so their estimates must not be added together.</p>}
        <AnalyticsTable rows={rows} analytics={analytics} kind={tab} invoiceRate={invoiceRate} />
      </section>
    </>}
  </div>;
}

function AnalyticsTrend({ analytics, invoiceRate }: { analytics: AnalyticsData; invoiceRate: number | null }) {
  const [metric, setMetric] = useState<TrendMetric>(invoiceRate !== null ? "invoice" : analytics.valuationCoverage === "complete" ? "value" : "usage");
  const effectiveMetric: TrendMetric = metric === "invoice" && invoiceRate === null ? analytics.valuationCoverage === "complete" ? "value" : "usage" : metric;
  const valueFor = (point: AnalyticsData["series"][number]) => effectiveMetric === "invoice" && invoiceRate !== null
    ? point.usage * invoiceRate
    : effectiveMetric === "value" ? point.usageValue ?? 0 : point.usage;
  const max = Math.max(...analytics.series.map(valueFor), 1);
  const labelEvery = Math.max(1, Math.ceil(analytics.series.length / 8));
  const titleMetric = effectiveMetric === "invoice" ? analytics.unit === "usd" ? "reported cost" : "estimated invoice" : effectiveMetric === "value" ? "usage value" : "usage";
  return <section className="panel analytics-trend"><div className="panel-heading"><div><span className="eyebrow">Over time</span><h2>{analytics.bucket === "day" ? "Daily" : analytics.bucket === "week" ? "Weekly" : "Monthly"} {titleMetric}</h2></div><div className="trend-metric-tabs"><button className={effectiveMetric === "invoice" ? "active" : ""} disabled={invoiceRate === null} onClick={() => setMetric("invoice")}>Invoice cost</button><button className={effectiveMetric === "value" ? "active" : ""} disabled={analytics.valuationCoverage !== "complete"} onClick={() => setMetric("value")}>Usage value</button><button className={effectiveMetric === "usage" ? "active" : ""} onClick={() => setMetric("usage")}>Usage</button></div></div><div className="analytics-chart-scroll"><div className="analytics-chart" style={{ gridTemplateColumns: `repeat(${Math.max(analytics.series.length, 1)}, minmax(18px, 1fr))` }} role="img" aria-label={`${analytics.bucket} ${titleMetric} trend`}>
    {analytics.series.map((point, index) => { const value = valueFor(point); const display = effectiveMetric === "usage" ? `${formatNumber(value)} ${analytics.unit}` : formatMoney(value, analytics.settings.currency); return <div className="analytics-column" key={point.key} title={`${point.label}: ${display}`}><div className="analytics-bar-track"><span style={{ height: `${value === 0 ? 2 : Math.max(5, (value / max) * 100)}%` }} /></div><small>{index % labelEvery === 0 || index === analytics.series.length - 1 ? point.label : ""}</small></div>; })}
  </div></div><div className="chart-footnote"><span><i />{effectiveMetric === "usage" ? analytics.unit : `${titleMetric} · ${analytics.settings.currency}`}</span><p>{analytics.startDate} through {analytics.endDate} · Source: {analytics.source}</p></div></section>;
}

function AnalyticsTable({ rows, analytics, kind, invoiceRate }: { rows: AnalyticsBreakdownRow[]; analytics: AnalyticsData; kind: AnalyticsTab; invoiceRate: number | null }) {
  if (!rows.length) return <div className="empty-state"><BarChart3 size={22} /><strong>No usage in this selection</strong><p>Choose another period or import attributed usage rows.</p></div>;
  return <div className="table-scroll"><table><thead><tr><th>{kind === "users" ? "Person" : kind === "groups" ? "Group" : "Entity"}</th><th>Usage</th><th>Usage value</th><th>{analytics.unit === "usd" ? "Reported cost" : "Est. invoice"}</th><th>Selection share</th><th>Active users</th><th>Cost / active</th><th>Messages</th></tr></thead><tbody>{rows.map((row) => { const rowInvoice = invoiceRate === null ? null : row.usage * invoiceRate; return <tr key={row.id}><td>{kind === "entities" && <span className="entity-indicator" style={{ background: entityColors[row.label as Entity] ?? entityColors.Unknown }} />}<span><strong>{row.label}</strong><small>{row.sublabel ?? `${row.memberCount} directory members`}</small></span></td><td><strong className="usage-cell">{formatNumber(row.usage)}</strong></td><td>{formatMoney(row.usageValue, analytics.settings.currency)}</td><td><strong>{rowInvoice === null ? "Unavailable" : formatMoney(rowInvoice, analytics.settings.currency)}</strong></td><td>{analytics.totals.usage ? `${((row.usage / analytics.totals.usage) * 100).toFixed(1)}%` : "0%"}</td><td>{row.activeUsers}</td><td>{formatMoney(rowInvoice === null ? null : rowInvoice / Math.max(row.activeUsers, 1), analytics.settings.currency)}</td><td>{formatNumber(row.messages)}</td></tr>; })}</tbody></table></div>;
}

function BillingSnapshot({ settings, onOpenSettings }: { settings: AppSettings; onOpenSettings: () => void }) {
  const spend = estimatedInvoice(settings);
  const overageHeadroom = settings.workspaceOverageLimitCredits === null || settings.unbilledOverageCredits === null ? null : settings.workspaceOverageLimitCredits - settings.unbilledOverageCredits;
  const hasSnapshot = settings.currentCreditBalance !== null || settings.unbilledOverageCredits !== null || settings.workspaceOverageLimitCredits !== null || settings.billingPeriodStart || settings.billingPeriodEnd;
  return <section className="panel billing-snapshot"><div className="panel-heading"><div><span className="eyebrow">Workspace billing</span><h2>OpenAI Billing snapshot</h2></div><button className="text-button" onClick={onOpenSettings}>{hasSnapshot ? "Update snapshot" : "Add snapshot"}<ChevronRight size={14} /></button></div><p className="table-note">Entered manually from OpenAI Billing. The workspace-level overage calibrates cost estimates; committed credit balance, budget target, and usage value remain distinct concepts.</p><div className="billing-snapshot-grid billing-snapshot-grid--six"><span><small>Current credit balance</small><strong>{settings.currentCreditBalance === null ? "Not recorded" : formatNumber(settings.currentCreditBalance)}</strong></span><span><small>Unbilled overage</small><strong>{settings.unbilledOverageCredits === null ? "Not recorded" : `${formatNumber(settings.unbilledOverageCredits)} credits`}</strong></span><span><small>Overage limit</small><strong>{settings.workspaceOverageLimitCredits === null ? "Not recorded" : `${formatNumber(settings.workspaceOverageLimitCredits)} credits`}</strong></span><span><small>Overage headroom</small><strong>{overageHeadroom === null ? "Not recorded" : `${formatNumber(Math.abs(overageHeadroom))} ${overageHeadroom < 0 ? "over" : "credits"}`}</strong></span><span><small>Estimated invoice (overage)</small><strong>{formatMoney(spend, settings.currency)}</strong></span><span><small>Billing period</small><strong>{settings.billingPeriodStart || settings.billingPeriodEnd ? `${settings.billingPeriodStart ?? "—"} – ${settings.billingPeriodEnd ?? "—"}` : "Not recorded"}</strong></span></div></section>;
}

function MembersView({ data, members, totalMembers, entity, query, onEntityChange, onQueryChange, onSelectMember }: { data: DashboardData; members: Member[]; totalMembers: number; entity: EntityFilter; query: string; onEntityChange: (entity: EntityFilter) => void; onQueryChange: (query: string) => void; onSelectMember: (member: Member) => void }) {
  const [groupFilter, setGroupFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const visibleMembers = members.filter((member) => {
    const matchesGroup = groupFilter === "all" || (groupFilter === "unassigned" && member.groups.length === 0) || (groupFilter === "multiple" && member.groups.length > 1) || (groupFilter.startsWith("group:") && member.groups.includes(groupFilter.slice("group:".length)));
    const matchesProfile = profileFilter === "all" || (profileFilter === "missing" && member.peopleMatch !== "Matched") || (profileFilter === "matched" && member.peopleMatch === "Matched");
    return matchesGroup && matchesProfile;
  });
  return <div className="page-content">
    <PageIntro eyebrow="Directory" title="Members" description="Filter identities by entity, People API profile, and current group membership." actions={<><a className="button button--secondary" href="/api/export"><Download size={16} />Export</a><a className="button button--primary" href="https://admin.openai.com/" target="_blank" rel="noreferrer"><ExternalLink size={16} />Open Admin Console</a></>} />
    <div className="filters-panel members-filters">
      <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search people, roles or groups" /><kbd>⌘ K</kbd></label>
      <div className="filter-divider" />
      <div className="segmented-filter">{(["All", "Allegro", "eBilet", "Ceneo", "Unknown"] as EntityFilter[]).map((value) => <button key={value} className={entity === value ? "active" : ""} onClick={() => onEntityChange(value)}>{value}</button>)}</div>
      <label className="member-filter-select"><span>Groups</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">All memberships</option><option value="unassigned">Not grouped</option><option value="multiple">More than one group</option>{data.groups.map((group) => <option key={group.id} value={`group:${group.name}`}>{group.name}</option>)}</select></label>
      <label className="member-filter-select"><span>People API</span><select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="all">All profiles</option><option value="missing">Missing or ambiguous</option><option value="matched">Matched</option></select></label>
      <span className="result-count">{visibleMembers.length} of {totalMembers}</span>
    </div>
    <section className="panel members-table"><div className="table-scroll"><table><thead><tr><th>Person</th><th>Entity</th><th>People API role</th><th>Groups</th><th>Usage</th><th>Usage value</th><th>Status</th><th /></tr></thead><tbody>{visibleMembers.map((member) => <tr key={member.id} onClick={() => onSelectMember(member)}><td><span className="avatar">{initials(member.name)}</span><span><strong>{member.name}</strong><small>{member.email}</small></span></td><td><span className="entity-pill"><i style={{ background: entityColors[member.entity] }} />{member.entity}</span></td><td>{member.peopleRole ? <span className="role-cell"><strong>{member.peopleRole}</strong><small>{member.department || "—"}</small></span> : <span className="pill pill--warning">Profile missing</span>}</td><td><div className="group-tags">{member.groups.slice(0, 2).map((group) => <span key={group}>{group}</span>)}{member.groups.length > 2 && <span>+{member.groups.length - 2}</span>}{member.groups.length === 0 && <small>Unassigned</small>}</div></td><td><strong className="usage-cell">{formatNumber(member.usage)}</strong></td><td>{formatMoney(usageValue(member.usage, data), data.settings.currency)}</td><td><span className={`pill ${member.status === "Active" ? "pill--green" : "pill--neutral"}`}>{member.status}</span></td><td><ChevronRight size={15} /></td></tr>)}</tbody></table></div>{visibleMembers.length === 0 && <div className="empty-state"><Search size={22} /><strong>No members found</strong><p>Try different search, entity, profile, or membership filters.</p></div>}</section>
  </div>;
}

function ChangesView({ changes, onSelectMember, onMarkRead }: { changes: ChangeEvent[]; onSelectMember: (id: string) => void; onMarkRead: () => void }) {
  const unread = changes.filter((change) => change.unread).length;
  return <div className="page-content"><PageIntro eyebrow="Since the last snapshot" title="Changes" description="A reviewable audit trail of member, role, entity, and group differences." actions={<button className="button button--secondary" onClick={onMarkRead}><Check size={16} />Mark all read</button>} /><div className="change-summary"><span><Bell size={17} /><strong>{unread} unread changes</strong></span><p>Added-by is shown only when an upstream source provides an actor; directory-only events remain explicitly unknown.</p></div><section className="panel changes-panel"><div className="changes-date"><span>Latest sync</span><small>{changes.length} events</small></div>{changes.map((change) => <button className={`change-detail-row${change.unread ? " unread" : ""}`} key={change.id} onClick={() => change.subjectId && onSelectMember(change.subjectId)}><span className={`change-kind change-kind--${change.kind}`}>{change.kind === "group" ? <Group size={16} /> : change.kind === "entity" ? <Building2 size={16} /> : change.kind === "role" ? <ShieldCheck size={16} /> : <Users size={16} />}</span><span className="change-copy"><strong>{change.person}</strong><span>{change.action}</span><small>{change.detail}</small><small className="change-attribution">{changeAttribution(change)}</small></span><span className="entity-pill"><i style={{ background: entityColors[change.entity] }} />{change.entity}</span><time>{change.time}</time><ChevronRight size={15} /></button>)}</section></div>;
}

function ChangeRow({ change }: { change: ChangeEvent }) {
  return <div className="change-row"><span className={`change-dot change-dot--${change.kind}`}><i /></span><span><strong>{change.person}</strong><small>{change.action} · {change.detail}</small><small className="change-attribution">{changeAttribution(change)}</small></span><time>{change.time}</time></div>;
}

function MemberDrawer({ member, groups, data, onClose }: { member: Member; groups: WorkspaceGroup[]; data: DashboardData; onClose: () => void }) {
  const [saving, setSaving] = useState(false); const [savedGroups, setSavedGroups] = useState(member.groups);
  const [status, setStatus] = useState<string | null>(null); const [pendingGroup, setPendingGroup] = useState<WorkspaceGroup | null>(null);
  async function confirmGroupChange(group: WorkspaceGroup) {
    if (group.source === "SCIM") return;
    const hasGroup = savedGroups.includes(group.name); setSaving(true); setStatus(null);
    try { const response = await fetch("/api/group-membership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: member.id, groupId: group.id, action: hasGroup ? "remove" : "add" }) }); const payload = await response.json() as { error?: string; message?: string }; if (!response.ok) throw new Error(payload.error || "Group update failed"); setSavedGroups((current) => hasGroup ? current.filter((name) => name !== group.name) : [...current, group.name]); setStatus(payload.message || "Group membership updated and verified."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Group update failed"); }
    finally { setSaving(false); setPendingGroup(null); }
  }
  const pendingAction = pendingGroup && savedGroups.includes(pendingGroup.name) ? "remove from" : "add to";
  const value = usageValue(member.usage, data);
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`Member details for ${member.name}`}><button className="drawer-scrim" onClick={onClose} aria-label="Close member details" /><aside className="member-drawer"><div className="drawer-header"><span className="eyebrow">Member profile</span><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="member-hero"><span className="avatar avatar--large">{initials(member.name)}</span><div><h2>{member.name}</h2><p>{member.email}</p><span className="entity-pill"><i style={{ background: entityColors[member.entity] }} />{member.entity}</span></div></div><div className="profile-section"><h3>Organization</h3><dl><div><dt>People API role</dt><dd>{member.peopleRole || "Missing"}</dd></div><div><dt>Department</dt><dd>{member.department || "—"}</dd></div><div><dt>Manager</dt><dd>{member.manager}</dd></div><div><dt>Workspace role</dt><dd>{member.workspaceRole}</dd></div></dl></div><div className="profile-section"><h3>Workspace addition</h3><dl><div><dt>Added / invited</dt><dd>{formatDateTime(member.addedAt)}</dd></div><div><dt>Added by</dt><dd>{memberAdditionLabel(member)}</dd></div><div><dt>Attribution source</dt><dd>{member.additionSource ?? "Legacy snapshot"}</dd></div></dl><p className="section-helper">Inviter identity cannot be inferred from a snapshot. Codexlens stores it only when the upstream API explicitly supplies it.</p></div><div className="profile-section"><div className="profile-section-heading"><h3>Group membership</h3><span>{savedGroups.length}</span></div><p className="section-helper">Manual groups can be changed here. SCIM groups are read-only.</p><div className="membership-list">{groups.map((group) => { const checked = savedGroups.includes(group.name); return <button key={group.id} disabled={saving || group.source === "SCIM"} onClick={() => setPendingGroup(group)}><span className={`check-box${checked ? " checked" : ""}`}>{checked && <Check size={13} />}</span><span><strong>{group.name}</strong><small>{group.source}</small></span>{group.source === "SCIM" && <ShieldCheck size={14} />}</button>; })}</div>{status && <div className="drawer-status">{status}</div>}</div><div className="profile-section usage-highlight usage-highlight--three"><span><small>Usage</small><strong>{formatNumber(member.usage)}</strong></span><span><small>Usage value</small><strong>{formatMoney(value, data.settings.currency)}</strong></span><span><small>Messages</small><strong>{formatNumber(member.messages)}</strong></span></div>{pendingGroup && <div className="confirm-layer"><div className="confirm-card"><span className="eyebrow">Confirm workspace change</span><h3>{pendingAction === "add to" ? "Add" : "Remove"} group membership?</h3><p>This will {pendingAction} <strong>{member.name}</strong> {pendingAction === "add to" ? "the" : ""} <strong>{pendingGroup.name}</strong> group in ChatGPT, then verify the result.</p><div><button className="button button--secondary" onClick={() => setPendingGroup(null)} disabled={saving}>Cancel</button><button className="button button--primary" onClick={() => confirmGroupChange(pendingGroup)} disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Confirm</button></div></div></div>}</aside></div>;
}

function SettingsDrawer({ settings, usageUnit, onClose, onSaved }: { settings: AppSettings; usageUnit: DashboardData["usageUnit"]; onClose: () => void; onSaved: (settings: AppSettings) => void }) {
  const [price, setPrice] = useState(settings.pricePerCredit?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(settings.currency);
  const [currentBalance, setCurrentBalance] = useState(settings.currentCreditBalance?.toString() ?? "");
  const [overage, setOverage] = useState(settings.unbilledOverageCredits?.toString() ?? "");
  const [overageLimit, setOverageLimit] = useState(settings.workspaceOverageLimitCredits?.toString() ?? "");
  const [billingBudget, setBillingBudget] = useState(settings.billingBudgetAmount?.toString() ?? "");
  const [alertPercent, setAlertPercent] = useState(settings.budgetAlertPercent.toString());
  const [periodStart, setPeriodStart] = useState(settings.billingPeriodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(settings.billingPeriodEnd ?? "");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function save() {
    setSaving(true); setError(null);
    try { const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pricePerCredit: price.trim() === "" ? null : Number(price), currency, currentCreditBalance: currentBalance.trim() === "" ? null : Number(currentBalance), unbilledOverageCredits: overage.trim() === "" ? null : Number(overage), workspaceOverageLimitCredits: overageLimit.trim() === "" ? null : Number(overageLimit), billingBudgetAmount: billingBudget.trim() === "" ? null : Number(billingBudget), budgetAlertPercent: Number(alertPercent), billingPeriodStart: periodStart || null, billingPeriodEnd: periodEnd || null }) }); const payload = await response.json() as AppSettings & { error?: string }; if (!response.ok) throw new Error(payload.error || "Could not save settings."); onSaved(payload); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save settings."); }
    finally { setSaving(false); }
  }
  const example = price.trim() && Number.isFinite(Number(price)) ? 1000 * Number(price) : null;
  const overageSpend = overage.trim() && price.trim() && Number.isFinite(Number(overage)) && Number.isFinite(Number(price)) ? Number(overage) * Number(price) : null;
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Usage valuation, budget, and billing settings"><button className="drawer-scrim" onClick={onClose} aria-label="Close settings" /><aside className="member-drawer settings-drawer"><div className="drawer-header"><span className="eyebrow">Workspace settings</span><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="settings-hero"><span className="settings-icon"><SlidersHorizontal size={20} /></span><div><h2>Budget & billing</h2><p>Set planning guardrails and keep invoice assumptions explicit.</p></div></div><div className="profile-section"><h3>Usage valuation</h3><label className="field-label"><span>Price per credit</span><div className="price-input"><input type="number" min="0" step="0.0001" inputMode="decimal" placeholder="0.0000" value={price} onChange={(event) => setPrice(event.target.value)} /><select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>USD</option><option>PLN</option><option>EUR</option></select></div></label><div className="formula-card"><span>Usage value</span><strong>attributed credits × price per credit</strong><small>{example === null ? "Enter a price to preview the calculation." : `1,000 credits = ${formatMoney(example, currency)}`}</small></div>{usageUnit === "tokens" && <div className="read-only-note"><Activity size={17} /><span><strong>Current imports use tokens</strong><small>Token rows are not converted with the credit rate. Import credits or monetary rows for value reporting.</small></span></div>}</div><div className="profile-section billing-fields"><h3>OpenAI Billing snapshot</h3><p className="section-helper">Copy workspace-level figures from Admin Console. They stay local and are used as an analytical reference.</p><div className="billing-field-grid"><label className="field-label"><span>Current credit balance</span><input type="number" min="0" step="1" inputMode="decimal" placeholder="0" value={currentBalance} onChange={(event) => setCurrentBalance(event.target.value)} /></label><label className="field-label"><span>Unbilled overage credits</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="244408" value={overage} onChange={(event) => setOverage(event.target.value)} /></label><label className="field-label"><span>Workspace overage limit</span><input type="number" min="0" step="1" inputMode="decimal" placeholder="Optional" value={overageLimit} onChange={(event) => setOverageLimit(event.target.value)} /></label><label className="field-label"><span>Period start</span><input type="date" value={periodStart} max={periodEnd || undefined} onChange={(event) => setPeriodStart(event.target.value)} /></label><label className="field-label"><span>Period end</span><input type="date" value={periodEnd} min={periodStart || undefined} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div><div className="formula-card"><span>Estimated invoice (overage)</span><strong>unbilled overage × price per credit</strong><small>{overageSpend === null ? "Enter the Billing overage to calculate it." : `${formatNumber(Number(overage))} credits = ${formatMoney(overageSpend, currency)}`}</small></div></div><div className="profile-section billing-fields"><h3>Budget guardrails</h3><p className="section-helper">The target belongs to the saved billing period. Analytics prorates it by day for unfiltered periods; it is never allocated to groups or entities.</p><div className="billing-field-grid"><label className="field-label"><span>Billing-cycle budget ({currency})</span><input type="number" min="0" step="1" inputMode="decimal" placeholder="10000" value={billingBudget} onChange={(event) => setBillingBudget(event.target.value)} /></label><label className="field-label"><span>Alert at (%)</span><input type="number" min="1" max="100" step="1" inputMode="decimal" value={alertPercent} onChange={(event) => setAlertPercent(event.target.value)} /></label></div></div><div className="settings-note"><ShieldCheck size={16} /><p>Usage value measures all attributed credits at the selected rate. Reported USD rows are direct cost data; calibrated credit estimates and forecasts are planning data. Issued invoices remain authoritative.</p></div>{error && <div className="drawer-status">{error}</div>}<div className="settings-actions"><button className="button button--secondary" onClick={onClose}>Cancel</button><button className="button button--primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save settings</button></div></aside></div>;
}
