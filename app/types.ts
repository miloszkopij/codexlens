export type Entity = "Allegro" | "eBilet" | "Ceneo" | "Unknown";

export type DataMode = "demo" | "live" | "cached";

export type UsageUnit = "credits" | "tokens" | "usd";
export type Currency = "USD" | "PLN" | "EUR";
export type AnalyticsBucket = "day" | "week" | "month";
export type AttributionSource = "Workspace Admin API" | "SCIM" | "Directory sync" | "Codexlens" | "Legacy snapshot";

export interface AppSettings {
  pricePerCredit: number | null;
  currency: Currency;
  currentCreditBalance: number | null;
  unbilledOverageCredits: number | null;
  workspaceOverageLimitCredits: number | null;
  billingBudgetAmount: number | null;
  budgetAlertPercent: number;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
}

export interface OrganizerMappings {
  roleToGroups: Record<string, string[]>;
  entityToGroups: Partial<Record<Entity, string[]>>;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  workspaceRole: "Owner" | "Admin" | "Member";
  peopleRole: string | null;
  department: string | null;
  manager: string | null;
  entity: Entity;
  groups: string[];
  usage: number;
  messages: number;
  status: "Active" | "Invited" | "Inactive";
  peopleMatch: "Matched" | "Missing" | "Ambiguous";
  addedAt?: string | null;
  addedByName?: string | null;
  addedByEmail?: string | null;
  additionSource?: AttributionSource;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  usage: number;
  activeMembers: number;
  source: "Manual" | "SCIM";
  accent: "mint" | "blue" | "violet" | "amber" | "rose" | "slate";
}

export interface ChangeEvent {
  id: string;
  person: string;
  subjectId?: string;
  action: string;
  detail: string;
  time: string;
  entity: Entity;
  kind: "member" | "group" | "role" | "entity";
  unread: boolean;
  actorName?: string | null;
  actorEmail?: string | null;
  actorSource?: AttributionSource;
}

export interface UsagePoint {
  label: string;
  credits: number;
}

export interface AnalyticsSeriesPoint {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  usage: number;
  usageValue: number | null;
  messages: number;
  activeUsers: number;
}

export interface AnalyticsBreakdownRow {
  id: string;
  label: string;
  sublabel?: string;
  usage: number;
  usageValue: number | null;
  messages: number;
  activeUsers: number;
  memberCount: number;
}

export interface AnalyticsData {
  startDate: string;
  endDate: string;
  bucket: AnalyticsBucket;
  groupId: string | null;
  entity: Entity | null;
  unit: UsageUnit | "mixed";
  source: string;
  settings: AppSettings;
  valuationCoverage: "complete" | "partial" | "unavailable";
  totals: {
    usage: number;
    usageValue: number | null;
    messages: number;
    activeUsers: number;
    totalMembers: number;
    averageUsagePerActive: number;
    averageUsageValuePerActive: number | null;
  };
  series: AnalyticsSeriesPoint[];
  byEntity: AnalyticsBreakdownRow[];
  byGroup: AnalyticsBreakdownRow[];
  byUser: AnalyticsBreakdownRow[];
  warning: string | null;
}

export interface ManagementCostRow {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  department: string | null;
  memberCount: number;
  activeUsers: number;
  messages: number;
  usage: number;
  usageValue: number | null;
  davidOrgShare: number;
  invoiceShare: number;
  allocatedInvoiceCost: number | null;
  reconciliation: boolean;
}

export interface ManagementCostData {
  leader: {
    id: string;
    name: string;
    email: string | null;
    title: string | null;
  };
  startDate: string;
  endDate: string;
  billingPeriodEnd: string | null;
  unit: UsageUnit | "mixed";
  source: string;
  currency: Currency;
  workspaceUsage: number;
  workspaceUsageValue: number | null;
  estimatedInvoice: number | null;
  invoiceSnapshotPeriod: string | null;
  invoiceAllocationAvailable: boolean;
  davidOrgUsage: number;
  davidOrgInvoiceShare: number;
  davidOrgAllocatedCost: number | null;
  mappedMembers: number;
  unresolvedMembers: number;
  rows: ManagementCostRow[];
  warning: string | null;
}

export interface DashboardData {
  mode: DataMode;
  workspaceName: string;
  workspaceId: string;
  lastSyncedAt: string | null;
  usageSource: string;
  usageUnit: UsageUnit;
  settings: AppSettings;
  members: Member[];
  groups: WorkspaceGroup[];
  changes: ChangeEvent[];
  trend: UsagePoint[];
}
