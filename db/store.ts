import { env } from "cloudflare:workers";
import type {
  AnalyticsBreakdownRow, AnalyticsBucket, AnalyticsData, AppSettings, ChangeEvent,
  Currency, DashboardData, Entity, Member, OrganizerMappings, UsageUnit, WorkspaceGroup,
} from "../app/types";

type Bindings = { DB?: D1Database };
type RawMember = Omit<Member, "groups" | "usage" | "messages"> & { company?: string | null };
type RawGroup = Pick<WorkspaceGroup, "id" | "name" | "description" | "source">;

export interface SnapshotInput {
  members: RawMember[];
  groups: RawGroup[];
  memberships: Array<{ memberId: string; groupId: string }>;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    workspace_role TEXT NOT NULL, people_role TEXT, department TEXT, manager TEXT,
    entity TEXT NOT NULL DEFAULT 'Unknown', company TEXT,
    status TEXT NOT NULL DEFAULT 'Active', people_match TEXT NOT NULL DEFAULT 'Missing',
    added_at TEXT, added_by_name TEXT, added_by_email TEXT,
    addition_source TEXT NOT NULL DEFAULT 'Directory sync',
    sync_version TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'Manual', sync_version TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    member_id TEXT NOT NULL, group_id TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (member_id, group_id)
  )`,
  `CREATE TABLE IF NOT EXISTS change_events (
    id TEXT PRIMARY KEY, subject_id TEXT, person TEXT NOT NULL, action TEXT NOT NULL,
    detail TEXT NOT NULL, entity TEXT NOT NULL DEFAULT 'Unknown', kind TEXT NOT NULL,
    actor_name TEXT, actor_email TEXT, actor_source TEXT NOT NULL DEFAULT 'Legacy snapshot',
    unread INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY, member_id TEXT NOT NULL, period_start TEXT NOT NULL,
    period_end TEXT NOT NULL, amount REAL NOT NULL, messages INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'credits', source TEXT NOT NULL, imported_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
    users_count INTEGER NOT NULL DEFAULT 0, groups_count INTEGER NOT NULL DEFAULT 0,
    changes_count INTEGER NOT NULL DEFAULT 0, error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_members_email ON members(email)`,
  `CREATE INDEX IF NOT EXISTS idx_members_entity ON members(entity)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_group_id ON memberships(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_changes_created_at ON change_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_member_period ON usage_records(member_id, period_end)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_period_end ON usage_records(period_end)`,
];

function db() {
  const binding = (env as unknown as Bindings).DB;
  if (!binding) throw new Error("Local database is unavailable. Ensure .openai/hosting.json declares the DB binding.");
  return binding;
}

export async function initializeDatabase() {
  const database = db();
  for (const statement of schemaStatements) await database.prepare(statement).run();
  const [memberColumns, changeColumns] = await Promise.all([
    database.prepare("PRAGMA table_info('members')").all<{ name: string }>(),
    database.prepare("PRAGMA table_info('change_events')").all<{ name: string }>(),
  ]);
  const existing = new Set([
    ...memberColumns.results.map((column) => `members.${column.name}`),
    ...changeColumns.results.map((column) => `change_events.${column.name}`),
  ]);
  const upgrades = [
    ["members.added_at", "ALTER TABLE members ADD COLUMN added_at TEXT"],
    ["members.added_by_name", "ALTER TABLE members ADD COLUMN added_by_name TEXT"],
    ["members.added_by_email", "ALTER TABLE members ADD COLUMN added_by_email TEXT"],
    ["members.addition_source", "ALTER TABLE members ADD COLUMN addition_source TEXT NOT NULL DEFAULT 'Directory sync'"],
    ["change_events.actor_name", "ALTER TABLE change_events ADD COLUMN actor_name TEXT"],
    ["change_events.actor_email", "ALTER TABLE change_events ADD COLUMN actor_email TEXT"],
    ["change_events.actor_source", "ALTER TABLE change_events ADD COLUMN actor_source TEXT NOT NULL DEFAULT 'Legacy snapshot'"],
  ] as const;
  for (const [key, statement] of upgrades) {
    if (!existing.has(key)) await database.prepare(statement).run();
  }
  await database.prepare("PRAGMA optimize").run();
}

function asEntity(value: string | null): Entity {
  return value === "Allegro" || value === "eBilet" || value === "Ceneo" ? value : "Unknown";
}

function asAttributionSource(value: unknown): NonNullable<Member["additionSource"]> {
  return value === "Workspace Admin API" || value === "SCIM" || value === "Codexlens" || value === "Legacy snapshot" ? value : "Directory sync";
}

function titleCaseRole(value: string): Member["workspaceRole"] {
  const normalized = value.toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  return "Member";
}

function humanizeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

const accents: WorkspaceGroup["accent"][] = ["mint", "blue", "violet", "amber", "rose", "slate"];

const defaultSettings: AppSettings = {
  pricePerCredit: 0.04,
  currency: "USD",
  currentCreditBalance: null,
  unbilledOverageCredits: null,
  workspaceOverageLimitCredits: null,
  billingBudgetAmount: null,
  budgetAlertPercent: 80,
  billingPeriodStart: null,
  billingPeriodEnd: null,
};

function isCurrency(value: string): value is Currency {
  return value === "USD" || value === "PLN" || value === "EUR";
}

async function readSettings(database: D1Database): Promise<AppSettings> {
  const rows = await database.prepare(`SELECT key, value FROM app_settings WHERE key IN (
    'price_per_credit', 'currency', 'current_credit_balance', 'unbilled_overage_credits',
    'workspace_overage_limit_credits', 'billing_budget_amount', 'budget_alert_percent',
    'billing_period_start', 'billing_period_end'
  )`).all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  const rawPrice = values.get("price_per_credit");
  const parsedPrice = rawPrice === "null" ? null : rawPrice === undefined || rawPrice === "" ? defaultSettings.pricePerCredit : Number(rawPrice);
  const rawCurrency = values.get("currency") ?? defaultSettings.currency;
  const nullableNumber = (key: string) => {
    const value = values.get(key);
    if (value === undefined || value === "" || value === "null") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const parsedAlert = Number(values.get("budget_alert_percent") ?? defaultSettings.budgetAlertPercent);
  return {
    pricePerCredit: parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,
    currency: isCurrency(rawCurrency) ? rawCurrency : defaultSettings.currency,
    currentCreditBalance: nullableNumber("current_credit_balance"),
    unbilledOverageCredits: nullableNumber("unbilled_overage_credits"),
    workspaceOverageLimitCredits: nullableNumber("workspace_overage_limit_credits"),
    billingBudgetAmount: nullableNumber("billing_budget_amount"),
    budgetAlertPercent: Number.isFinite(parsedAlert) && parsedAlert >= 1 && parsedAlert <= 100 ? parsedAlert : defaultSettings.budgetAlertPercent,
    billingPeriodStart: values.get("billing_period_start") || null,
    billingPeriodEnd: values.get("billing_period_end") || null,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  await initializeDatabase();
  return readSettings(db());
}

export async function saveAppSettings(input: AppSettings): Promise<AppSettings> {
  await initializeDatabase();
  const database = db();
  const now = new Date().toISOString();
  const price = input.pricePerCredit;
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) {
    throw new Error("Price per credit must be a non-negative number.");
  }
  if (!isCurrency(input.currency)) throw new Error("Choose USD, PLN, or EUR as the reporting currency.");
  for (const [label, value] of [
    ["Current credit balance", input.currentCreditBalance],
    ["Unbilled overage", input.unbilledOverageCredits],
    ["Workspace overage limit", input.workspaceOverageLimitCredits],
    ["Billing budget", input.billingBudgetAmount],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000)) throw new Error(`${label} must be a non-negative number.`);
  }
  if (!Number.isFinite(input.budgetAlertPercent) || input.budgetAlertPercent < 1 || input.budgetAlertPercent > 100) {
    throw new Error("Budget alert threshold must be between 1 and 100 percent.");
  }
  for (const [label, value] of [["Billing period start", input.billingPeriodStart], ["Billing period end", input.billingPeriodEnd]] as const) {
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a valid date.`);
  }
  if (input.billingPeriodStart && input.billingPeriodEnd && input.billingPeriodStart > input.billingPeriodEnd) {
    throw new Error("Billing period start must not be after its end.");
  }
  const valueStatement = (key: string, value: string) => database.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(key, value, now);
  await database.batch([
    valueStatement("price_per_credit", price === null ? "null" : String(price)),
    valueStatement("currency", input.currency),
    valueStatement("current_credit_balance", input.currentCreditBalance === null ? "null" : String(input.currentCreditBalance)),
    valueStatement("unbilled_overage_credits", input.unbilledOverageCredits === null ? "null" : String(input.unbilledOverageCredits)),
    valueStatement("workspace_overage_limit_credits", input.workspaceOverageLimitCredits === null ? "null" : String(input.workspaceOverageLimitCredits)),
    valueStatement("billing_budget_amount", input.billingBudgetAmount === null ? "null" : String(input.billingBudgetAmount)),
    valueStatement("budget_alert_percent", String(input.budgetAlertPercent)),
    valueStatement("billing_period_start", input.billingPeriodStart ?? ""),
    valueStatement("billing_period_end", input.billingPeriodEnd ?? ""),
  ]);
  return { ...input, pricePerCredit: price };
}

function parseStringArrayMap(value: string | undefined): Record<string, string[]> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, groupIds]) => {
      if (!key.trim()) return [];
      const values = (Array.isArray(groupIds) ? groupIds : [groupIds])
        .filter((groupId): groupId is string => typeof groupId === "string" && Boolean(groupId.trim()))
        .map((groupId) => groupId.trim());
      return values.length ? [[key.trim(), [...new Set(values)]]] : [];
    }));
  } catch {
    return {};
  }
}

async function readOrganizerMappings(database: D1Database): Promise<OrganizerMappings> {
  const rows = await database.prepare("SELECT key, value FROM app_settings WHERE key IN ('organizer_role_mappings', 'organizer_entity_mappings')").all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  const entityMap = parseStringArrayMap(values.get("organizer_entity_mappings"));
  return {
    roleToGroups: parseStringArrayMap(values.get("organizer_role_mappings")),
    entityToGroups: Object.fromEntries(Object.entries(entityMap).filter(([entity]) => entity === "Allegro" || entity === "eBilet" || entity === "Ceneo" || entity === "Unknown")),
  };
}

export async function getOrganizerMappings(): Promise<OrganizerMappings> {
  await initializeDatabase();
  return readOrganizerMappings(db());
}

export async function saveOrganizerMappings(input: OrganizerMappings): Promise<OrganizerMappings> {
  await initializeDatabase();
  const database = db();
  const writableRows = await database.prepare("SELECT id FROM workspace_groups WHERE source != 'SCIM'").all<{ id: string }>();
  const writableGroupIds = new Set(writableRows.results.map((row) => row.id));
  const normalizeGroups = (groupIds: string[]) => [...new Set(groupIds.map((groupId) => String(groupId).trim()).filter(Boolean))];
  const roleToGroups: Record<string, string[]> = Object.fromEntries(Object.entries(input.roleToGroups)
    .map(([role, groupIds]) => [role.trim(), normalizeGroups(groupIds)] as const)
    .filter(([role, groupIds]) => role && groupIds.length));
  const entityToGroups: Partial<Record<Entity, string[]>> = Object.fromEntries(Object.entries(input.entityToGroups)
    .filter(([entity, groupIds]) => (entity === "Allegro" || entity === "eBilet" || entity === "Ceneo" || entity === "Unknown") && Array.isArray(groupIds))
    .map(([entity, groupIds]) => [entity, normalizeGroups(groupIds as string[])])
    .filter(([, groupIds]) => groupIds.length));
  for (const groupId of [...Object.values(roleToGroups).flat(), ...Object.values(entityToGroups).flat()]) {
    if (!writableGroupIds.has(groupId)) throw new Error("Mappings can target only manual groups from the latest workspace snapshot.");
  }
  if (Object.keys(roleToGroups).length > 1_000) throw new Error("Too many role mappings.");
  const saved: OrganizerMappings = { roleToGroups, entityToGroups };
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('organizer_role_mappings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(JSON.stringify(roleToGroups), now),
    database.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('organizer_entity_mappings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(JSON.stringify(entityToGroups), now),
  ]);
  return saved;
}

function usageValue(amount: number, unit: UsageUnit, settings: AppSettings) {
  if (unit === "usd") return amount;
  if (unit === "credits" && settings.pricePerCredit !== null) return amount * settings.pricePerCredit;
  return null;
}

export async function getDashboard(workspaceId: string, workspaceName: string): Promise<DashboardData | null> {
  await initializeDatabase();
  const database = db();
  const count = await database.prepare("SELECT COUNT(*) AS count FROM members").first<{ count: number }>();
  if (!count?.count) return null;

  const [memberRows, groupRows, membershipRows, usageRows, changeRows, syncRow, settings] = await Promise.all([
    database.prepare(`SELECT id, name, email, workspace_role, people_role, department, manager, entity, status, people_match, added_at, added_by_name, added_by_email, addition_source FROM members ORDER BY name COLLATE NOCASE`).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, name, description, source FROM workspace_groups ORDER BY name COLLATE NOCASE`).all<Record<string, unknown>>(),
    database.prepare(`SELECT ms.member_id, g.id AS group_id, g.name AS group_name FROM memberships ms JOIN workspace_groups g ON g.id = ms.group_id`).all<Record<string, unknown>>(),
    database.prepare(`SELECT member_id, SUM(amount) AS amount, SUM(messages) AS messages, MAX(unit) AS unit, MAX(source) AS source FROM usage_records GROUP BY member_id`).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, subject_id, person, action, detail, entity, kind, actor_name, actor_email, actor_source, unread, created_at FROM change_events ORDER BY created_at DESC LIMIT 100`).all<Record<string, unknown>>(),
    database.prepare(`SELECT finished_at FROM sync_runs WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`).first<{ finished_at: string }>(),
    readSettings(database),
  ]);

  const groupNames = new Map<string, string[]>();
  const membersByGroup = new Map<string, Set<string>>();
  for (const row of membershipRows.results) {
    const memberId = String(row.member_id); const groupId = String(row.group_id);
    groupNames.set(memberId, [...(groupNames.get(memberId) ?? []), String(row.group_name)]);
    const ids = membersByGroup.get(groupId) ?? new Set<string>(); ids.add(memberId); membersByGroup.set(groupId, ids);
  }
  const usage = new Map(usageRows.results.map((row) => [String(row.member_id), { amount: Number(row.amount ?? 0), messages: Number(row.messages ?? 0), unit: String(row.unit ?? "credits"), source: String(row.source ?? "Not connected") }]));

  const members: Member[] = memberRows.results.map((row) => ({
    id: String(row.id), name: String(row.name), email: String(row.email), workspaceRole: titleCaseRole(String(row.workspace_role)),
    peopleRole: row.people_role ? String(row.people_role) : null, department: row.department ? String(row.department) : null,
    manager: row.manager ? String(row.manager) : null, entity: asEntity(String(row.entity)),
    groups: (groupNames.get(String(row.id)) ?? []).sort(), usage: usage.get(String(row.id))?.amount ?? 0,
    messages: usage.get(String(row.id))?.messages ?? 0,
    status: row.status === "Invited" || row.status === "Inactive" ? row.status : "Active",
    peopleMatch: row.people_match === "Matched" || row.people_match === "Ambiguous" ? row.people_match : "Missing",
    addedAt: row.added_at ? String(row.added_at) : null,
    addedByName: row.added_by_name ? String(row.added_by_name) : null,
    addedByEmail: row.added_by_email ? String(row.added_by_email) : null,
    additionSource: asAttributionSource(row.addition_source),
  }));
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const groups: WorkspaceGroup[] = groupRows.results.map((row, index) => {
    const memberIds = [...(membersByGroup.get(String(row.id)) ?? new Set<string>())];
    const groupMembers = memberIds.map((id) => memberMap.get(id)).filter((member): member is Member => Boolean(member));
    return {
      id: String(row.id), name: String(row.name), description: String(row.description ?? ""), source: row.source === "SCIM" ? "SCIM" : "Manual",
      memberCount: groupMembers.length, activeMembers: groupMembers.filter((member) => member.status === "Active").length,
      usage: groupMembers.reduce((sum, member) => sum + member.usage, 0), accent: accents[index % accents.length],
    };
  });
  const changes: ChangeEvent[] = changeRows.results.map((row) => ({
    id: String(row.id), subjectId: row.subject_id ? String(row.subject_id) : undefined, person: String(row.person),
    action: String(row.action), detail: String(row.detail), entity: asEntity(String(row.entity)),
    kind: ["member", "group", "role", "entity"].includes(String(row.kind)) ? String(row.kind) as ChangeEvent["kind"] : "member",
    actorName: row.actor_name ? String(row.actor_name) : null,
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    actorSource: asAttributionSource(row.actor_source),
    unread: Boolean(row.unread), time: humanizeTime(String(row.created_at)),
  }));
  const trendRows = await database.prepare(`SELECT period_end, SUM(amount) AS amount FROM usage_records GROUP BY period_end ORDER BY period_end DESC LIMIT 8`).all<{ period_end: string; amount: number }>();
  const newestUsage = usage.values().next().value as { unit: string; source: string } | undefined;
  const unit = newestUsage?.unit === "tokens" || newestUsage?.unit === "usd" ? newestUsage.unit : "credits";

  return {
    mode: "cached", workspaceName, workspaceId, lastSyncedAt: syncRow?.finished_at ?? null,
    usageSource: newestUsage?.source ?? "Not connected — import a workspace analytics CSV", usageUnit: unit,
    settings,
    members, groups, changes,
    trend: trendRows.results.reverse().map((row) => ({ label: new Date(`${row.period_end}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "2-digit", timeZone: "UTC" }), credits: Number(row.amount ?? 0) })),
  };
}

export type AnalyticsInput = {
  startDate: string;
  endDate: string;
  bucket: AnalyticsBucket;
  groupId?: string | null;
  entity?: Entity | null;
};

type UsageRecordRow = {
  member_id: string;
  name: string;
  email: string;
  entity: string;
  period_start: string;
  period_end: string;
  amount: number;
  messages: number;
  unit: string;
  source: string;
};

type AnalyticsAccumulator = {
  id: string;
  label: string;
  sublabel?: string;
  usage: number;
  usageValue: number;
  valuedRows: number;
  rowCount: number;
  messages: number;
  users: Set<string>;
  memberCount?: number;
};

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function bucketBounds(value: string, bucket: AnalyticsBucket) {
  const date = utcDate(value);
  if (bucket === "week") {
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
  } else if (bucket === "month") date.setUTCDate(1);
  const start = new Date(date);
  const end = new Date(date);
  if (bucket === "day") end.setUTCDate(end.getUTCDate());
  else if (bucket === "week") end.setUTCDate(end.getUTCDate() + 6);
  else end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const label = bucket === "month"
    ? start.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" })
    : bucket === "week"
      ? `W/C ${start.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}`
      : start.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  return { key: isoDate(start), label, periodStart: isoDate(start), periodEnd: isoDate(end) };
}

function nextBucket(value: string, bucket: AnalyticsBucket) {
  const date = utcDate(value);
  if (bucket === "day") date.setUTCDate(date.getUTCDate() + 1);
  else if (bucket === "week") date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return isoDate(date);
}

function toBreakdown(accumulator: AnalyticsAccumulator): AnalyticsBreakdownRow {
  return {
    id: accumulator.id,
    label: accumulator.label,
    sublabel: accumulator.sublabel,
    usage: accumulator.usage,
    usageValue: accumulator.valuedRows === accumulator.rowCount ? accumulator.usageValue : null,
    messages: accumulator.messages,
    activeUsers: accumulator.users.size,
    memberCount: accumulator.memberCount ?? accumulator.users.size,
  };
}

function addToAccumulator(
  map: Map<string, AnalyticsAccumulator>,
  identity: { id: string; label: string; sublabel?: string; memberCount?: number },
  row: UsageRecordRow,
  value: number | null,
) {
  const current = map.get(identity.id) ?? {
    ...identity, usage: 0, usageValue: 0, valuedRows: 0, rowCount: 0, messages: 0, users: new Set<string>(),
  };
  current.usage += Number(row.amount ?? 0);
  current.messages += Number(row.messages ?? 0);
  current.rowCount += 1;
  if (value !== null) { current.usageValue += value; current.valuedRows += 1; }
  if (Number(row.amount ?? 0) > 0) current.users.add(row.member_id);
  map.set(identity.id, current);
}

export async function getAnalytics(input: AnalyticsInput): Promise<AnalyticsData> {
  await initializeDatabase();
  const database = db();
  const settings = await readSettings(database);
  const entity = input.entity && asEntity(input.entity) === input.entity ? input.entity : null;
  const groupId = input.groupId || null;
  const rows = await database.prepare(`SELECT u.member_id, m.name, m.email, m.entity, u.period_start, u.period_end,
      u.amount, u.messages, u.unit, u.source
    FROM usage_records u
    JOIN members m ON m.id = u.member_id
    WHERE u.period_end >= ? AND u.period_end <= ?
      AND (? = '' OR m.entity = ?)
      AND (? = '' OR EXISTS (
        SELECT 1 FROM memberships mf WHERE mf.member_id = m.id AND mf.group_id = ?
      ))
    ORDER BY u.period_end, m.name COLLATE NOCASE`)
    .bind(input.startDate, input.endDate, entity ?? "", entity ?? "", groupId ?? "", groupId ?? "")
    .all<UsageRecordRow>();

  const directoryCount = await database.prepare(`SELECT COUNT(*) AS count FROM members m
    WHERE (? = '' OR m.entity = ?)
      AND (? = '' OR EXISTS (SELECT 1 FROM memberships mf WHERE mf.member_id = m.id AND mf.group_id = ?))`)
    .bind(entity ?? "", entity ?? "", groupId ?? "", groupId ?? "")
    .first<{ count: number }>();
  const membershipRows = await database.prepare(`SELECT ms.member_id, g.id AS group_id, g.name AS group_name
    FROM memberships ms JOIN workspace_groups g ON g.id = ms.group_id`).all<{ member_id: string; group_id: string; group_name: string }>();
  const groupDirectoryRows = await database.prepare(`SELECT g.id, g.name, COUNT(DISTINCT m.id) AS count
    FROM workspace_groups g
    LEFT JOIN memberships ms ON ms.group_id = g.id
    LEFT JOIN members m ON m.id = ms.member_id AND (? = '' OR m.entity = ?)
    WHERE (? = '' OR g.id = ?)
    GROUP BY g.id, g.name ORDER BY g.name COLLATE NOCASE`)
    .bind(entity ?? "", entity ?? "", groupId ?? "", groupId ?? "")
    .all<{ id: string; name: string; count: number }>();
  const unassignedRow = groupId ? null : await database.prepare(`SELECT COUNT(*) AS count FROM members m
    WHERE (? = '' OR m.entity = ?) AND NOT EXISTS (SELECT 1 FROM memberships mu WHERE mu.member_id = m.id)`)
    .bind(entity ?? "", entity ?? "").first<{ count: number }>();
  const unassignedCount = Number(unassignedRow?.count ?? 0);
  const membershipsByMember = new Map<string, Array<{ id: string; name: string }>>();
  for (const membership of membershipRows.results) {
    const list = membershipsByMember.get(membership.member_id) ?? [];
    list.push({ id: membership.group_id, name: membership.group_name });
    membershipsByMember.set(membership.member_id, list);
  }
  const countsByGroup = new Map(groupDirectoryRows.results.map((row) => [row.id, Number(row.count)]));

  const seriesMap = new Map<string, AnalyticsAccumulator>();
  const entityMap = new Map<string, AnalyticsAccumulator>();
  const groupMap = new Map<string, AnalyticsAccumulator>();
  const userMap = new Map<string, AnalyticsAccumulator>();
  const units = new Set<UsageUnit>();
  const sources = new Set<string>();
  for (const group of groupDirectoryRows.results) groupMap.set(group.id, {
    id: group.id, label: group.name, memberCount: Number(group.count), usage: 0, usageValue: 0,
    valuedRows: 0, rowCount: 0, messages: 0, users: new Set<string>(),
  });
  if (!groupId) groupMap.set("__unassigned__", {
    id: "__unassigned__", label: "Unassigned", sublabel: "No current group membership",
    memberCount: unassignedCount, usage: 0, usageValue: 0,
    valuedRows: 0, rowCount: 0, messages: 0, users: new Set<string>(),
  });
  let totalUsage = 0; let totalValue = 0; let valuedRows = 0; let messages = 0;
  const activeUsers = new Set<string>();
  let coarsePeriods = false;

  for (const row of rows.results) {
    const unit: UsageUnit = row.unit === "tokens" || row.unit === "usd" ? row.unit : "credits";
    const value = usageValue(Number(row.amount ?? 0), unit, settings);
    units.add(unit); sources.add(row.source);
    totalUsage += Number(row.amount ?? 0); messages += Number(row.messages ?? 0);
    if (value !== null) { totalValue += value; valuedRows += 1; }
    if (Number(row.amount ?? 0) > 0) activeUsers.add(row.member_id);
    const bounds = bucketBounds(row.period_end, input.bucket);
    addToAccumulator(seriesMap, { id: bounds.key, label: bounds.label, sublabel: `${bounds.periodStart}|${bounds.periodEnd}` }, row, value);
    addToAccumulator(entityMap, { id: asEntity(row.entity), label: asEntity(row.entity) }, row, value);
    addToAccumulator(userMap, { id: row.member_id, label: row.name, sublabel: `${row.email} · ${asEntity(row.entity)}`, memberCount: 1 }, row, value);
    const memberGroups = membershipsByMember.get(row.member_id) ?? [];
    for (const group of memberGroups) {
      if (groupId && group.id !== groupId) continue;
      addToAccumulator(groupMap, { id: group.id, label: group.name, memberCount: countsByGroup.get(group.id) ?? 0 }, row, value);
    }
    if (!groupId && memberGroups.length === 0) addToAccumulator(groupMap, { id: "__unassigned__", label: "Unassigned", sublabel: "No current group membership", memberCount: unassignedCount }, row, value);
    const sourceDays = Math.round((utcDate(row.period_end).getTime() - utcDate(row.period_start).getTime()) / 86_400_000) + 1;
    if ((input.bucket === "day" && sourceDays > 1) || (input.bucket === "week" && sourceDays > 7)) coarsePeriods = true;
  }

  const series = [];
  let cursor = bucketBounds(input.startDate, input.bucket).key;
  const last = bucketBounds(input.endDate, input.bucket).key;
  while (cursor <= last && series.length < 740) {
    const bounds = bucketBounds(cursor, input.bucket);
    const value = seriesMap.get(bounds.key);
    series.push({
      key: bounds.key, label: bounds.label, periodStart: bounds.periodStart, periodEnd: bounds.periodEnd,
      usage: value?.usage ?? 0,
      usageValue: value ? (value.valuedRows === value.rowCount ? value.usageValue : null) : (settings.pricePerCredit !== null ? 0 : null),
      messages: value?.messages ?? 0, activeUsers: value?.users.size ?? 0,
    });
    cursor = nextBucket(cursor, input.bucket);
  }
  const totalRows = rows.results.length;
  const valuationCoverage: AnalyticsData["valuationCoverage"] = totalRows === 0
    ? (settings.pricePerCredit !== null ? "complete" : "unavailable")
    : valuedRows === 0 ? "unavailable" : valuedRows === totalRows ? "complete" : "partial";
  const activeCount = activeUsers.size;
  const warningParts = [];
  if (coarsePeriods) warningParts.push(`Some source rows span longer than one ${input.bucket}; they are placed in the bucket containing their period end.`);
  if (units.size > 1) warningParts.push("The selection contains mixed usage units; usage totals should not be treated as directly comparable.");
  if (valuationCoverage === "partial") warningParts.push("Usage value excludes rows that cannot be valued with the configured credit rate.");
  return {
    startDate: input.startDate, endDate: input.endDate, bucket: input.bucket, groupId, entity,
    unit: units.size > 1 ? "mixed" : ([...units][0] ?? "credits"),
    source: sources.size ? [...sources].join(", ") : "No usage data in this period",
    settings: units.size === 1 && units.has("usd") ? { ...settings, currency: "USD" } : settings,
    valuationCoverage,
    totals: {
      usage: totalUsage,
      usageValue: valuationCoverage === "complete" ? totalValue : null,
      messages,
      activeUsers: activeCount,
      totalMembers: Number(directoryCount?.count ?? 0),
      averageUsagePerActive: activeCount ? totalUsage / activeCount : 0,
      averageUsageValuePerActive: valuationCoverage === "complete" && activeCount ? totalValue / activeCount : valuationCoverage === "complete" ? 0 : null,
    },
    series,
    byEntity: [...entityMap.values()].map(toBreakdown).sort((a, b) => b.usage - a.usage),
    byGroup: [...groupMap.values()].map(toBreakdown).sort((a, b) => b.usage - a.usage),
    byUser: [...userMap.values()].map(toBreakdown).sort((a, b) => b.usage - a.usage),
    warning: warningParts.join(" ") || null,
  };
}

function fieldLabel(field: keyof RawMember) {
  const labels: Partial<Record<keyof RawMember, string>> = { peopleRole: "People API role", department: "Department", manager: "Manager", entity: "Entity", workspaceRole: "Workspace role", status: "Status" };
  return labels[field] ?? String(field);
}

export async function saveSnapshot(input: SnapshotInput, runId: string, startedAt: string) {
  await initializeDatabase();
  const database = db(); const now = new Date().toISOString();
  const previousMembers = await database.prepare("SELECT * FROM members").all<Record<string, unknown>>();
  const previousMemberships = await database.prepare("SELECT member_id, group_id FROM memberships").all<{ member_id: string; group_id: string }>();
  const previousById = new Map(previousMembers.results.map((row) => [String(row.id), row]));
  const hadPreviousSnapshot = previousById.size > 0;
  const newById = new Map(input.members.map((member) => [member.id, member]));
  const previousMembershipSet = new Set(previousMemberships.results.map((row) => `${row.member_id}\u0000${row.group_id}`));
  const newMembershipSet = new Set(input.memberships.map((row) => `${row.memberId}\u0000${row.groupId}`));
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const events: Array<Omit<ChangeEvent, "time"> & { createdAt: string }> = [];

  if (hadPreviousSnapshot) {
    for (const member of input.members) {
      const previous = previousById.get(member.id);
      if (!previous) {
        events.push({ id: crypto.randomUUID(), subjectId: member.id, person: member.name, action: "Member joined", detail: member.email, entity: member.entity, kind: "member", unread: true,
          actorName: member.addedByName ?? null, actorEmail: member.addedByEmail ?? null, actorSource: member.additionSource ?? "Directory sync", createdAt: now });
        continue;
      }
      const comparisons: Array<[keyof RawMember, unknown, unknown]> = [
        ["peopleRole", previous.people_role, member.peopleRole], ["department", previous.department, member.department],
        ["manager", previous.manager, member.manager], ["entity", previous.entity, member.entity],
        ["workspaceRole", previous.workspace_role, member.workspaceRole], ["status", previous.status, member.status],
      ];
      for (const [field, before, after] of comparisons) {
        if (String(before ?? "") === String(after ?? "")) continue;
        events.push({ id: crypto.randomUUID(), subjectId: member.id, person: member.name,
          action: `${fieldLabel(field)} changed`, detail: `${String(before ?? "Missing")} → ${String(after ?? "Missing")}`,
          entity: member.entity, kind: field === "entity" ? "entity" : field === "peopleRole" || field === "workspaceRole" ? "role" : "member", unread: true, createdAt: now });
      }
    }
    for (const [id, previous] of previousById) if (!newById.has(id)) {
      events.push({ id: crypto.randomUUID(), subjectId: id, person: String(previous.name), action: "Member removed", detail: String(previous.email), entity: asEntity(String(previous.entity)), kind: "member", unread: true, createdAt: now });
    }
    for (const membership of input.memberships) {
      const key = `${membership.memberId}\u0000${membership.groupId}`;
      if (!previousMembershipSet.has(key)) {
        const member = newById.get(membership.memberId); const group = groupsById.get(membership.groupId);
        if (member && group) events.push({ id: crypto.randomUUID(), subjectId: member.id, person: member.name, action: "Joined a group", detail: group.name, entity: member.entity, kind: "group", unread: true, createdAt: now });
      }
    }
    for (const key of previousMembershipSet) if (!newMembershipSet.has(key)) {
      const [memberId, groupId] = key.split("\u0000"); const previous = previousById.get(memberId); const group = groupsById.get(groupId);
      if (previous) events.push({ id: crypto.randomUUID(), subjectId: memberId, person: String(previous.name), action: "Left a group", detail: group?.name ?? groupId, entity: asEntity(String(previous.entity)), kind: "group", unread: true, createdAt: now });
    }
  }

  await database.prepare(`INSERT INTO sync_runs (id, started_at, finished_at, status, users_count, groups_count, changes_count) VALUES (?, ?, ?, 'success', ?, ?, ?)`)
    .bind(runId, startedAt, now, input.members.length, input.groups.length, events.length).run();
  for (const member of input.members) await database.prepare(`INSERT INTO members (id, name, email, workspace_role, people_role, department, manager, entity, company, status, people_match, added_at, added_by_name, added_by_email, addition_source, sync_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, workspace_role=excluded.workspace_role,
      people_role=excluded.people_role, department=excluded.department, manager=excluded.manager, entity=excluded.entity, company=excluded.company,
      status=excluded.status, people_match=excluded.people_match, added_at=COALESCE(excluded.added_at, members.added_at),
      added_by_name=COALESCE(excluded.added_by_name, members.added_by_name), added_by_email=COALESCE(excluded.added_by_email, members.added_by_email),
      addition_source=CASE WHEN excluded.added_by_name IS NOT NULL OR excluded.added_by_email IS NOT NULL OR excluded.addition_source = 'SCIM' THEN excluded.addition_source ELSE members.addition_source END,
      sync_version=excluded.sync_version, updated_at=excluded.updated_at`)
    .bind(member.id, member.name, member.email, member.workspaceRole, member.peopleRole, member.department, member.manager, member.entity, member.company ?? null, member.status, member.peopleMatch,
      member.addedAt ?? null, member.addedByName ?? null, member.addedByEmail ?? null, member.additionSource ?? "Directory sync", runId, now).run();
  await database.prepare("DELETE FROM members WHERE sync_version != ?").bind(runId).run();

  for (const group of input.groups) await database.prepare(`INSERT INTO workspace_groups (id, name, description, source, sync_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, source=excluded.source, sync_version=excluded.sync_version, updated_at=excluded.updated_at`)
    .bind(group.id, group.name, group.description, group.source, runId, now).run();
  await database.prepare("DELETE FROM workspace_groups WHERE sync_version != ?").bind(runId).run();
  await database.prepare("DELETE FROM memberships").run();
  for (const membership of input.memberships) await database.prepare("INSERT INTO memberships (member_id, group_id, updated_at) VALUES (?, ?, ?)").bind(membership.memberId, membership.groupId, now).run();
  for (const event of events) await database.prepare(`INSERT INTO change_events (id, subject_id, person, action, detail, entity, kind, actor_name, actor_email, actor_source, unread, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(event.id, event.subjectId ?? null, event.person, event.action, event.detail, event.entity, event.kind, event.actorName ?? null, event.actorEmail ?? null, event.actorSource ?? "Directory sync", event.createdAt).run();
  return events.length;
}

export async function saveFailedSync(runId: string, startedAt: string, error: string) {
  await initializeDatabase();
  await db().prepare(`INSERT INTO sync_runs (id, started_at, finished_at, status, error) VALUES (?, ?, ?, 'failed', ?)`)
    .bind(runId, startedAt, new Date().toISOString(), error.slice(0, 1000)).run();
}

export async function getStoredGroup(groupId: string) {
  await initializeDatabase();
  return db().prepare("SELECT id, name, source FROM workspace_groups WHERE id = ?").bind(groupId).first<{ id: string; name: string; source: string }>();
}

export async function getStoredMember(memberId: string) {
  await initializeDatabase();
  return db().prepare("SELECT id, name FROM members WHERE id = ?").bind(memberId).first<{ id: string; name: string }>();
}

export async function setStoredMembership(memberId: string, groupId: string, action: "add" | "remove", actor?: { name?: string | null; email?: string | null }) {
  const database = db(); const now = new Date().toISOString();
  if (action === "add") await database.prepare("INSERT OR REPLACE INTO memberships (member_id, group_id, updated_at) VALUES (?, ?, ?)").bind(memberId, groupId, now).run();
  else await database.prepare("DELETE FROM memberships WHERE member_id = ? AND group_id = ?").bind(memberId, groupId).run();
  const subject = await database.prepare(`SELECT m.name, m.entity, g.name AS group_name FROM members m CROSS JOIN workspace_groups g WHERE m.id = ? AND g.id = ?`).bind(memberId, groupId).first<{ name: string; entity: string; group_name: string }>();
  if (subject) await database.prepare(`INSERT INTO change_events (id, subject_id, person, action, detail, entity, kind, actor_name, actor_email, actor_source, unread, created_at) VALUES (?, ?, ?, ?, ?, ?, 'group', ?, ?, 'Codexlens', 1, ?)`)
    .bind(crypto.randomUUID(), memberId, subject.name, action === "add" ? "Joined a group" : "Left a group", subject.group_name, subject.entity, actor?.name ?? null, actor?.email ?? null, now).run();
}

export async function markAllChangesRead() {
  await initializeDatabase();
  await db().prepare("UPDATE change_events SET unread = 0 WHERE unread = 1").run();
}

export interface UsageImportRow { email?: string; memberId?: string; amount: number; messages: number; periodStart: string; periodEnd: string; unit: "credits" | "tokens" | "usd"; }

export async function importUsage(rows: UsageImportRow[], source: string) {
  await initializeDatabase(); const database = db(); const now = new Date().toISOString();
  const members = await database.prepare("SELECT id, LOWER(email) AS email FROM members").all<{ id: string; email: string }>();
  const memberIds = new Set(members.results.map((member) => member.id));
  const byEmail = new Map(members.results.map((member) => [member.email, member.id]));
  let imported = 0; let unmatched = 0;
  for (const row of rows) {
    const memberId = row.memberId && memberIds.has(row.memberId)
      ? row.memberId
      : row.email ? byEmail.get(row.email.toLowerCase()) : undefined;
    if (!memberId) { unmatched += 1; continue; }
    const id = `${memberId}:${row.periodStart}:${row.periodEnd}:${row.unit}:${source}`;
    await database.prepare(`INSERT INTO usage_records (id, member_id, period_start, period_end, amount, messages, unit, source, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount, messages=excluded.messages, imported_at=excluded.imported_at`)
      .bind(id, memberId, row.periodStart, row.periodEnd, row.amount, row.messages, row.unit, source, now).run();
    imported += 1;
  }
  return { imported, unmatched };
}
