import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the codexlens workspace dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>codexlens — workspace intelligence<\/title>/i);
  assert.match(html, /workspace intelligence/i);
  assert.match(html, /See the shape of your workspace/i);
  assert.match(html, /Demo preview/i);
  assert.match(html, /Usage by entity/i);
  assert.match(html, /What changed/i);
  assert.match(html, /Usage value/i);
  assert.match(html, /Estimated invoice/i);
  assert.match(html, /Sync directory/i);
  assert.match(html, />Organize</i);
  assert.match(html, /David&#x27;s org/i);
  assert.match(html, /bubble-logo/);
});

test("rolls workspace usage into David Roberts direct-manager invoice shares", async () => {
  const [shell, view, route, peopleApi, config] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/ManagementCostView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/management-cost/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/people-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /id: "management", label: "David's org"/);
  assert.match(shell, /<ManagementCostView/);
  assert.match(view, /Fraction of invoice/);
  assert.match(view, /Share of David org/);
  assert.match(view, /Allocated invoice/);
  assert.match(view, /reconciliation row add to exactly 100%/);
  assert.match(route, /listEmployees/);
  assert.match(route, /directOwner/);
  assert.match(route, /row\.invoiceShare = workspaceUsage > 0 \? row\.usage \/ workspaceUsage/);
  assert.match(route, /__outside_david_org__/);
  assert.match(route, /invoice \* row\.invoiceShare/);
  assert.match(peopleApi, /findPersonByDisplayName/);
  assert.match(peopleApi, /\/employees/);
  assert.match(config, /MANAGEMENT_LEADER_NAME/);
});

test("provides a guarded role and entity group organizer", async () => {
  const [shell, organizer, rules, membershipRoute, mappingsRoute, store] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/OrganizerView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/role-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/group-membership/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/organizer-mappings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /id: "organize", label: "Organize"/);
  assert.match(shell, /<OrganizerView/);
  assert.match(organizer, /People API role/);
  assert.match(organizer, /Entity/);
  assert.match(organizer, /Use agreed role rules/);
  assert.match(organizer, /Manual destination mode/);
  assert.match(organizer, /Role & entity mappings/);
  assert.match(organizer, /People API role → groups/);
  assert.match(organizer, /Entity → groups/);
  assert.match(organizer, /GroupMultiSelect/);
  assert.match(organizer, /Without group/);
  assert.match(organizer, /More than one group/);
  assert.match(organizer, /roleToGroups/);
  assert.match(organizer, /Saving them does not change OpenAI/);
  assert.match(organizer, /buildMappedAssignments/);
  assert.match(organizer, /Review \{selectedRows\.length\} changes/);
  assert.match(organizer, /It does not remove existing memberships/);
  assert.match(organizer, /Target group is SCIM-managed/);
  assert.match(organizer, /People API role missing/);
  assert.match(organizer, /action: "add"/);
  assert.doesNotMatch(organizer, /action: "remove"/);
  assert.match(rules, /return "PM"/);
  assert.match(rules, /return "Developers"/);
  assert.match(membershipRoute, /body\.action !== "add"/);
  assert.match(mappingsRoute, /saveOrganizerMappings/);
  assert.match(store, /organizer_role_mappings/);
  assert.match(store, /organizer_entity_mappings/);
});

test("syncs Codex Analytics history and keeps actor provenance explicit", async () => {
  const [client, syncRoute, store, schema, adminClient, analyticsClient] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai-admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/codex-analytics.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /usageHistory\.message/);
  assert.match(client, /Unknown — not provided by directory API/);
  assert.match(client, /Added by/);
  assert.match(syncRoute, /usageHistory/);
  assert.match(syncRoute, /listDailyCodexUsage/);
  assert.match(syncRoute, /importUsage/);
  assert.match(analyticsClient, /\/analytics\/codex\/workspaces\//);
  assert.match(analyticsClient, /next_page/);
  assert.match(analyticsClient, /endTime - 1/);
  assert.match(analyticsClient, /Codex analytics API: Read/);
  assert.match(store, /actor_source/);
  assert.match(schema, /addedByEmail/);
  assert.match(adminClient, /added_by/);
  assert.match(adminClient, /is_scim_managed/);
});

test("keeps credentials server-side and group writes confirmable", async () => {
  const [client, page, config, demo, gitignore, example] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/demo-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(client, /Confirm workspace change/);
  assert.match(client, /SCIM groups are read-only/);
  const adminSecretPrefix = new RegExp(["sk", "admin"].join("-") + "-");
  assert.doesNotMatch(client, adminSecretPrefix);
  assert.match(config, /CHATGPT_ADMIN_KEY/);
  assert.doesNotMatch(config, adminSecretPrefix);
  assert.match(config, /workspaceId: workspaceId \?\? "demo-workspace"/);
  assert.match(demo, /workspaceId: "demo-workspace"/);
  assert.match(page, /forceDemo=\{params\.demo === "1"\}/);
  assert.match(client, /if \(forceDemo\) return/);
  assert.match(client, /illustrativeAnalytics/);
  assert.match(gitignore, /\.env\*/);
  assert.match(example, /CHATGPT_ADMIN_KEY=\n/);
  assert.match(example, /CHATGPT_WORKSPACE_ID=your_workspace_id/);
});

test("documents non-overlapping workspace usage semantics", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /workspace total sums each person once/i);
  assert.match(readme, /group totals can overlap/i);
  assert.match(readme, /never auto-assign/i);
  assert.match(readme, /usage value = attributed credits/i);
  assert.match(readme, /workspace overage are separate billing concepts/i);
  assert.match(readme, /daily, weekly, and monthly analytics/i);
});

test("exposes persisted pricing and filtered analytics routes", async () => {
  const [client, store, schema, analyticsRoute, settingsRoute] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analytics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /Daily/);
  assert.match(client, /Weekly/);
  assert.match(client, /Monthly/);
  assert.match(client, /All groups/);
  assert.match(client, /All entities/);
  assert.match(client, /OpenAI Billing snapshot/);
  assert.match(client, /Estimated invoice \(overage\)/);
  assert.match(client, /Period-end forecast/);
  assert.match(client, /Budget utilization/);
  assert.match(client, /Vs previous period/);
  assert.match(client, /Top 10 usage share/);
  assert.match(client, /Budget signals/);
  assert.match(client, /Invoice cost/);
  assert.match(client, /Invoice allocation model/);
  assert.match(client, /Calibrated overage share/);
  assert.match(client, /Group estimates use the calibrated overage share/);
  assert.match(client, /invoiceRate/);
  assert.match(client, /All usage, value, and activity metrics below use/);
  assert.match(client, /All Overview usage data uses this period/);
  assert.match(client, /Not grouped/);
  assert.match(client, /More than one group/);
  assert.doesNotMatch(client, /\{ id: "groups", label: "Groups"/);
  assert.match(client, /Unbilled overage credits/);
  assert.match(client, /Workspace overage limit/);
  assert.match(client, /Billing-cycle budget/);
  assert.match(client, /Alert at \(%\)/);
  assert.match(client, /Historical usage uses current membership/);
  assert.match(schema, /app_settings/);
  assert.match(store, /price_per_credit/);
  assert.match(store, /pricePerCredit: 0\.04/);
  assert.match(store, /billing_budget_amount/);
  assert.match(store, /budget_alert_percent/);
  assert.match(store, /__unassigned__/);
  assert.match(store, /valuationCoverage/);
  assert.match(client, /No historical usage has been loaded/);
  assert.match(analyticsRoute, /getAnalytics/);
  assert.match(settingsRoute, /saveAppSettings/);
});
