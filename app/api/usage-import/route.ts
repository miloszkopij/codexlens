import { getDashboard, importUsage, type UsageImportRow } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]; const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizedRows(text: string, fallbackUnit: UsageImportRow["unit"]): UsageImportRow[] {
  const rows = parseCsv(text); if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[ -]+/g, "_"));
  const indexOf = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const emailIndex = indexOf("email", "user_email");
  const amountIndex = indexOf("amount", "usage", "credits", "tokens", "cost", "total_usage");
  const messagesIndex = indexOf("messages", "total_messages");
  const startIndex = indexOf("period_start", "start_date", "date");
  const endIndex = indexOf("period_end", "end_date", "date");
  const unitIndex = indexOf("unit");
  if (emailIndex < 0 || amountIndex < 0 || startIndex < 0 || endIndex < 0) {
    throw new Error("CSV must include email, amount/credits/tokens, and period_start/period_end (or date) columns.");
  }
  return rows.slice(1).flatMap((row) => {
    const amount = Number(row[amountIndex]); const email = String(row[emailIndex] ?? "").trim();
    if (!email || !Number.isFinite(amount)) return [];
    const inferredUnit = headers[amountIndex] === "tokens" ? "tokens" : headers[amountIndex] === "cost" ? "usd" : headers[amountIndex] === "credits" ? "credits" : fallbackUnit;
    const rawUnit = String(row[unitIndex] ?? inferredUnit).toLowerCase();
    const unit: UsageImportRow["unit"] = rawUnit === "tokens" || rawUnit === "usd" ? rawUnit : "credits";
    return [{ email, amount, messages: Math.max(0, Number(row[messagesIndex] ?? 0) || 0), periodStart: String(row[startIndex]).slice(0, 10), periodEnd: String(row[endIndex]).slice(0, 10), unit }];
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Attach a CSV file in the file field." }, { status: 400 });
    const rawUnit = String(form.get("unit") ?? "credits");
    const fallbackUnit: UsageImportRow["unit"] = rawUnit === "tokens" || rawUnit === "usd" ? rawUnit : "credits";
    const rows = normalizedRows(await file.text(), fallbackUnit);
    if (!rows.length) return Response.json({ error: "The CSV contains no importable rows." }, { status: 400 });
    const source = String(form.get("source") ?? "Admin Console CSV").slice(0, 120);
    const result = await importUsage(rows, source);
    const config = getWorkspaceConfig();
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName);
    return Response.json({ ...result, dashboard });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Usage import failed." }, { status: 500 });
  }
}
