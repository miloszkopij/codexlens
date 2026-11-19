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
  assert.match(html, /Attributed usage value/i);
  assert.match(html, /Sync directory/i);
  assert.match(html, />Organize</i);
  assert.match(html, />Management</i);
  assert.match(html, /bubble-logo/);
});

test("server-renders the Management view with the configured demo default", async () => {
  const response = await render("/?demo=1&view=management");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /David Roberts.*teams/);
  assert.match(html, /Search manager/);
  assert.match(html, /Share of selected teams/);
  assert.match(html, /Outside David Roberts/);
});

test("server-renders Changes filters with People API and distinct OpenAI role types", async () => {
  const response = await render("/?demo=1&view=changes");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Change area/);
  assert.match(html, /Change type/);
  assert.match(html, /People API changes/);
  assert.match(html, /People API job title/);
  assert.match(html, /OpenAI workspace role/);
  assert.match(html, /Clear filters/);
  assert.match(html, /Demo history/);
  assert.match(html, /entire saved history/);
});

test("renders local role-group plans without claiming live permissions", async () => {
  const response = await render("/?demo=1&view=permissions");
  const html = await response.text();
  assert.equal(response.status, 200);
  for (const text of [/Local mapping plan/, /not live OpenAI permissions/, /Register role reference/, /By role/, /By group/, /Read-only demo/, /Current OpenAI configuration/, /Read-only OpenAI snapshot/, /No OpenAI role snapshot yet/, /No local role references registered/, /An empty local plan does not mean your workspace has no roles/]) assert.match(html,text);
  const analytics = await render("/?demo=1&view=analytics");
  assert.match(await analytics.text(), /N-1 coverage/);
});

test("renders the regular/special group policy and domain-first organizer", async () => {
  const members = await render("/?demo=1&view=members");
  const html = await members.text();
  for(const text of [/Members &amp; groups/, /Special groups only/, /One regular group/, /Multiple regular groups/, /People API job title/]) assert.match(html,text);
  const organizer = await render("/?demo=1&view=organize");
  const org = await organizer.text();
  for(const text of [/Email domain/, /regular group/, /Exact, case-insensitive/, /People API job title/, /Review people/, /Special groups/, /Manager’s structure/, /Find structure manager/, /Add structure rule/, /Includes the selected manager and all direct and indirect reports/, /nearest configured manager/, /Adds to your draft/, />Tech</, />Non-tech</, /Tech = /, /Non-tech = everyone outside/, /Filter job titles by email domain/, /Filter job titles by N-1 head/, /Filter job titles by Tech or Non-tech/, /Filter job titles by rule or assignment/, /No title rule/, /People without regular group/, /Without regular/, /Clear filters/]) assert.match(org,text);
});

test("rolls selected manager usage into direct-manager attributed values", async () => {
  const [shell, view, route, peopleApi, config] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/ManagementCostView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/management-cost/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/people-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /id: "management", label: "Management"/);
  assert.match(shell, /<ManagementCostView/);
  assert.match(view, /Search manager/);
  assert.match(view, /Share of workspace usage/);
  assert.match(view, /Share of selected teams/);
  assert.match(view, /Attributed value/);
  assert.match(view, /reconciliation row/);
  assert.match(route, /listEmployees/);
  assert.match(route, /directOwner/);
  assert.match(route, /row\.invoiceShare = workspaceUsage > 0 \? row\.usage \/ workspaceUsage/);
  assert.match(route, /managerId/);
  assert.match(route, /findPersonById/);
  assert.match(route, /__outside_selected_teams__/);
  assert.match(route, /row\.allocatedInvoiceCost = row\.usageValue/);
  assert.match(peopleApi, /findPersonByDisplayName/);
  assert.match(peopleApi, /findPersonById/);
  assert.match(peopleApi, /searchPeople/);
  assert.match(peopleApi, /listDirectoryPeople/);
  assert.match(peopleApi, /editDistance/);
  assert.match(peopleApi, /\/employees/);
  assert.match(config, /MANAGEMENT_LEADER_NAME/);
});

test("supports a People API manager picker with a David Roberts demo default", async () => {
  const [pickerRoute, view, demo, types, shell, readme] = await Promise.all([
    readFile(new URL("../app/api/management-managers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/ManagementCostView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demo-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(pickerRoute, /managementLeaderName/);
  assert.match(pickerRoute, /searchPeople/);
  assert.match(pickerRoute, /slice\(0, 20\)/);
  assert.match(view, /Reset to default/);
  assert.match(view, /managerId/);
  assert.match(view, /displayedManagement\.leader\.id !== selectedManager\.id/);
  assert.match(view, /No People API matches/);
  assert.match(view, /No direct reports found/);
  assert.match(view, /demoManagementManagers/);
  assert.match(demo, /demo-manager-david/);
  assert.match(demo, /demoManagementData/);
  assert.match(types, /ManagementManagerOption/);
  assert.match(types, /selectedOrgUsage/);
  assert.match(shell, /label: "Management"/);
  assert.match(readme, /defaults to David Roberts but can/i);
});

test("membership editors share the server-reviewed change path", async () => {
  const [organizer, editor, route, legacy, client] = await Promise.all([
    readFile(new URL("../app/ui/AccessOrganizerView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/MemberGroupEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/access-plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/group-membership/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai-admin.ts", import.meta.url), "utf8"),
  ]);
  assert.match(organizer, /emailDomainToGroups/);
  assert.match(organizer, /policyVersion: 2/);
  assert.match(editor, /Special groups/);
  assert.match(editor, /kind: "special"/);
  assert.match(editor, /action: present \? "remove" : "add"/);
  assert.match(route, /claimAccessPlan/);
  assert.match(route, /reviewFingerprint/);
  assert.match(route, /updateGroupMembership/);
  assert.match(legacy, /status: 410/);
  assert.ok(client.includes("manage/workspaces"));
});

test("syncs Codex Analytics history and keeps actor provenance explicit", async () => {
  const [client, syncRoute, store, schema, adminClient, analyticsClient] = await Promise.all([
    readFile(new URL("../app/ui/CodexlensApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/directory-sync.ts", import.meta.url), "utf8"),
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
  const editor = await readFile(new URL("../app/ui/MemberGroupEditor.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../app/ui/AccessChangeDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /Confirm workspace change/);
  assert.match(editor, /SCIM groups are read-only/);
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
  assert.match(readme, /job-title rules blocked/i);
  assert.match(readme, /never applies assignment rules/i);
  assert.match(readme, /usage value = attributed credits/i);
  assert.match(readme, /committed-credit/i);
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
  assert.match(client, /Manual overage value/);
  assert.match(client, /Usage-value forecast/);
  assert.match(client, /Budget utilization/);
  assert.match(client, /Vs previous period/);
  assert.match(client, /Top 10 usage share/);
  assert.match(client, /Budget signals/);
  assert.match(client, /OpenAI usage estimate/);
  assert.match(client, /Why this differs from Billing/);
  assert.match(client, /point-in-time balance/);
  assert.match(client, /group values must not be added together/);
  assert.match(client, /All usage, value, and activity metrics below use/);
  assert.match(client, /All Overview usage data uses this period/);
  const membersView = await readFile(new URL("../app/ui/MembersWorkspaceView.tsx", import.meta.url), "utf8");
  assert.match(membersView, /No groups/);
  assert.match(membersView, /Multiple regular groups/);
  assert.doesNotMatch(client, /\{ id: "groups", label: "Groups"/);
  assert.match(client, /Unbilled overage credits/);
  assert.match(client, /Workspace overage limit/);
  assert.match(client, /Billing-cycle budget/);
  assert.match(client, /Alert at \(%\)/);
  assert.match(client, /Usage is attributed using current group membership/);
  assert.match(client, /AnalyticsRoleSplit/);
  assert.match(client, /People API job-family split/);
  assert.match(client, /Data, Software, Product, Design, and Other/);
  assert.match(schema, /app_settings/);
  assert.match(store, /price_per_credit/);
  assert.match(store, /pricePerCredit: 0\.04/);
  assert.match(store, /billing_budget_amount/);
  assert.match(store, /budget_alert_percent/);
  assert.match(store, /__unassigned__/);
  assert.match(store, /people_role/);
  assert.match(store, /byRole/);
  assert.match(store, /valuationCoverage/);
  assert.match(client, /No historical usage has been loaded/);
  assert.match(analyticsRoute, /getAnalytics/);
  assert.match(settingsRoute, /saveAppSettings/);
});
