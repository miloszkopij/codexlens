import { fetchJson } from "./http";
import type { UsageImportRow } from "../db/store";

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseUnifiedUsageRow(value: unknown): UsageImportRow | null {
  const row = object(value);
  const actor = object(row.actor);
  const totals = object(row.totals);
  const start = number(row.start_time);
  const end = number(row.end_time);
  const memberId = string(row.user_id) ?? string(actor.user_id);
  const email = string(actor.email);
  const credits = number(totals.credits);
  if (!start || !end || end <= start || !memberId && !email || credits === null || credits < 0) return null;
  return {
    ...(memberId ? { memberId } : {}), ...(email ? { email } : {}),
    amount: credits,
    messages: Math.max(0, Math.round(number(totals.messages) ?? 0)),
    periodStart: new Date(start * 1000).toISOString().slice(0, 10),
    periodEnd: new Date((end - 1) * 1000).toISOString().slice(0, 10),
    unit: "credits",
    reportedCostUsd: number(totals.cost_usd),
    estimatedCostUsd: number(totals.estimated_cost_usd),
  };
}

export async function listDailyUnifiedUsage(baseUrl: string, workspaceId: string, adminKey: string, historyDays: number) {
  const end = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);
  const start = end - historyDays * 86_400_000;
  const rows: UsageImportRow[] = [];
  let fetched = 0;
  let pages = 0;
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ start_time: String(start / 1000), end_time: String(end / 1000), limit: "1000" });
    if (cursor) params.set("page", cursor);
    const page = await fetchJson<{ data?: unknown[]; has_more?: boolean; next_page?: string | null }>(
      `${baseUrl.replace(/\/$/, "")}/analytics/workspaces/${encodeURIComponent(workspaceId)}/usage?${params}`,
      { headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json" } },
    );
    pages += 1;
    const data = Array.isArray(page.data) ? page.data : [];
    fetched += data.length;
    rows.push(...data.map(parseUnifiedUsageRow).filter((row): row is UsageImportRow => row !== null));
    cursor = page.has_more ? string(page.next_page) : null;
    if (page.has_more && !cursor) throw new Error("Unified Analytics pagination returned no next_page cursor.");
    if (cursor && seen.has(cursor)) throw new Error("Unified Analytics pagination repeated a cursor.");
    if (cursor) seen.add(cursor);
    if (pages >= 1000 && cursor) throw new Error("Unified Analytics pagination exceeded 1,000 pages.");
  } while (cursor);
  if (fetched > 0 && rows.length === 0) throw new Error("Unified Analytics returned rows in an unsupported format.");
  return { rows, fetched, pages, startDate: new Date(start).toISOString().slice(0, 10), endDate: new Date(end - 1).toISOString().slice(0, 10) };
}
