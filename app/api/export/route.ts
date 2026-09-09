import { demoData } from "../../demo-data";
import { getDashboard } from "../../../db/store";
import { getWorkspaceConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

function usageValue(usage: number, unit: "credits" | "tokens" | "usd", pricePerCredit: number | null) {
  if (unit === "usd") return usage;
  if (unit === "credits" && pricePerCredit !== null) return usage * pricePerCredit;
  return "";
}

function cell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET() {
  try {
    const config = getWorkspaceConfig();
    const dashboard = await getDashboard(config.workspaceId, config.workspaceName) ?? demoData;
    const header = ["name", "email", "workspace_role", "people_role", "department", "manager", "entity", "groups", `usage_${dashboard.usageUnit}`, "usage_value_at_rate", "value_currency", "price_per_credit", "messages", "status", "people_match"];
    const rows = dashboard.members.map((member) => [
      member.name, member.email, member.workspaceRole, member.peopleRole, member.department,
      member.manager, member.entity, member.groups.join(" | "), member.usage,
      usageValue(member.usage, dashboard.usageUnit, dashboard.settings.pricePerCredit),
      dashboard.usageUnit === "usd" ? "USD" : dashboard.settings.currency,
      dashboard.settings.pricePerCredit ?? "", member.messages, member.status, member.peopleMatch,
    ]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="codexlens-members-${date}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Export failed." }, { status: 500 });
  }
}
