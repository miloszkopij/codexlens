import { fetchJson } from "./http";

type JsonRecord = Record<string, unknown>;

interface CodexUsagePage {
  data?: unknown[];
  has_more?: boolean;
  next_page?: string | null;
}

export interface CodexUsageRow {
  memberId?: string;
  email?: string;
  amount: number;
  messages: number;
  periodStart: string;
  periodEnd: string;
  unit: "credits";
}

export interface CodexUsageResult {
  rows: CodexUsageRow[];
  fetched: number;
  pages: number;
  startDate: string;
  endDate: string;
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(...values: unknown[]) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(row: JsonRecord, name: "credits" | "turns") {
  const totals = record(row.totals);
  const direct = finiteNumber(totals[name]);
  if (direct !== null) return direct;
  if (!Array.isArray(row.clients)) return null;
  let found = false;
  const total = row.clients.reduce((sum, client) => {
    const value = finiteNumber(record(client)[name]);
    if (value === null) return sum;
    found = true;
    return sum + value;
  }, 0);
  return found ? total : null;
}

function unixSeconds(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function utcDay(seconds: number) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function normalizeUsageRow(value: unknown): CodexUsageRow | null {
  const row = record(value);
  const user = record(row.user);
  const identity = record(row.identity);
  const rawUser = typeof row.user === "string" ? row.user : undefined;
  const memberId = stringValue(
    row.user_id,
    row.member_id,
    user.id,
    user.user_id,
    identity.id,
    identity.user_id,
    rawUser && !rawUser.includes("@") ? rawUser : undefined,
  );
  const email = stringValue(
    row.email,
    row.user_email,
    row.email_address,
    user.email,
    user.email_address,
    identity.email,
    rawUser?.includes("@") ? rawUser : undefined,
  );
  const startTime = unixSeconds(row.start_time);
  const endTime = unixSeconds(row.end_time);
  const credits = metric(row, "credits");
  if (startTime === null || endTime === null || endTime <= startTime || credits === null) return null;
  return {
    ...(memberId ? { memberId } : {}),
    ...(email ? { email } : {}),
    amount: Math.max(0, credits),
    messages: Math.max(0, Math.round(metric(row, "turns") ?? 0)),
    periodStart: utcDay(startTime),
    // The API's end_time is exclusive. Subtract one second so a daily row is
    // placed on the day it represents rather than the following midnight.
    periodEnd: utcDay(endTime - 1),
    unit: "credits",
  };
}

function analyticsWindow(historyDays: number) {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const start = end - historyDays * 86_400_000;
  return {
    startTime: Math.floor(start / 1000),
    endTime: Math.floor(end / 1000),
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(end - 1).toISOString().slice(0, 10),
  };
}

function headers(adminKey: string) {
  return { Authorization: `Bearer ${adminKey}`, Accept: "application/json" };
}

export async function listDailyCodexUsage(
  baseUrl: string,
  workspaceId: string,
  adminKey: string,
  historyDays: number,
): Promise<CodexUsageResult> {
  const window = analyticsWindow(historyDays);
  const rows: CodexUsageRow[] = [];
  let fetched = 0;
  let pages = 0;
  let pageCursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const params = new URLSearchParams({
      start_time: String(window.startTime),
      end_time: String(window.endTime),
      limit: "1000",
    });
    if (pageCursor) params.set("page", pageCursor);
    const page = await fetchJson<CodexUsagePage>(
      `${baseUrl.replace(/\/$/, "")}/analytics/codex/workspaces/${encodeURIComponent(workspaceId)}/usage?${params}`,
      { headers: headers(adminKey) },
    );
    pages += 1;
    const data = Array.isArray(page.data) ? page.data : [];
    fetched += data.length;
    rows.push(...data.map(normalizeUsageRow).filter((row): row is CodexUsageRow => row !== null));

    const nextPage = page.has_more ? stringValue(page.next_page) : undefined;
    if (page.has_more && !nextPage) throw new Error("Codex Analytics pagination returned no next_page cursor.");
    if (nextPage && seenCursors.has(nextPage)) throw new Error("Codex Analytics pagination repeated a cursor.");
    if (nextPage) seenCursors.add(nextPage);
    pageCursor = nextPage;
    if (pages >= 1000 && pageCursor) throw new Error("Codex Analytics pagination exceeded 1,000 pages.");
  } while (pageCursor);

  if (fetched > 0 && rows.length === 0) {
    throw new Error("Codex Analytics returned rows in an unsupported format; no daily credit records could be read.");
  }
  return { rows, fetched, pages, startDate: window.startDate, endDate: window.endDate };
}

export function codexAnalyticsError(error: unknown) {
  const message = error instanceof Error ? error.message : "Codex Analytics sync failed.";
  if (/HTTP (401|403)\b/.test(message)) {
    return "Codex Analytics access was denied. Create a workspace Admin key with Codex analytics API: Read, then update CHATGPT_ADMIN_KEY.";
  }
  if (/HTTP 404\b/.test(message)) {
    return "Codex Analytics was not found for this workspace. Verify CHATGPT_WORKSPACE_ID and that Analytics is enabled.";
  }
  return `Codex Analytics sync failed: ${message}`;
}
