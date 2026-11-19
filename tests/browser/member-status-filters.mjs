// Run against a local dev server. All API traffic is synthetic; no live changes.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const compiled = ts.transpileModule(await readFile(new URL("../../app/demo-data.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { demoData } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const groups = ["Developers", "PM", "Ceneo", "eBilet", "admin", "cat-team"].map((name) => ({ ...demoData.groups[0], id: name, name, source: "Manual" }));
const member = (name, groupIds, entity = "Allegro", peopleRole = "Engineer", peopleMatch = "Matched") => ({ ...demoData.members[0], id: name, name, email: `${name.replaceAll(" ", ".").toLowerCase()}@example.test`, entity, peopleRole, peopleMatch, status: "Active", groupIds, groups: groupIds });
const dashboard = { ...demoData, mode: "cached", workspaceId: "synthetic-status-test", groups, members: [
  member("Alpha Conflict", ["Developers", "PM"]), member("Beta Conflict", ["Developers", "Ceneo"], "Ceneo", "Analyst", "Missing"),
  member("Gamma Single", ["Developers", "admin", "cat-team"]), member("Delta Ungrouped", []),
  member("Epsilon Special", ["admin", "cat-team"]), member("Zeta Single", ["PM"], "eBilet", "Product Manager"),
] };
const base = process.env.CODEXLENS_TEST_URL || "http://127.0.0.1:3000";
const unexpected = []; const errors = []; const writes = [];
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const request = route.request(); const url = new URL(request.url());
  if (url.origin !== new URL(base).origin) { await route.abort(); return; }
  if (!url.pathname.startsWith("/api/")) return route.continue();
  if (request.method() !== "GET") { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 400, json: { error: "Test blocks all writes" } }); }
  const respond = (json) => route.fulfill({ json });
  if (url.pathname === "/api/dashboard") return respond(dashboard);
  if (url.pathname === "/api/organizer-mappings") return respond({ policyVersion: 2, roleToGroups: {}, emailDomainToGroups: {}, entityToGroups: {}, structureRules: [] });
  if (url.pathname === "/api/sync-settings") return respond({ settings: { enabled: false, intervalMinutes: 15 }, state: { status: "idle", lastSuccessAt: null, changes: 0, error: null } });
  unexpected.push(url.pathname); return route.fulfill({ status: 500, json: { error: "Unmocked API blocked" } });
});
const status = page.getByRole("combobox", { name: "Membership status", exact: true });
const people = () => page.locator("table tbody tr").allTextContents();
const expectNames = async (names) => {
  await page.waitForFunction((expected) => {
    const rows = [...document.querySelectorAll("table tbody tr")].map((row) => row.textContent);
    return rows.length === expected.length && expected.every((name) => rows.some((row) => row.includes(name)));
  }, names);
  assert.equal((await people()).length, names.length);
};
try {
  await page.goto(`${base}/?view=members`);
  await expectNames(dashboard.members.map((m) => m.name));
  await status.selectOption("conflict");
  await expectNames(["Alpha Conflict", "Beta Conflict"]);
  await page.getByRole("checkbox", { name: "Select visible people", exact: true }).check();
  await page.getByText("2 selected", { exact: true }).waitFor();
  await status.selectOption("single");
  await expectNames(["Gamma Single", "Zeta Single"]);
  assert.equal(await page.getByRole("button", { name: "Review move", exact: true }).count(), 0);
  assert.equal(await page.getByRole("checkbox", { name: "Select visible people", exact: true }).isChecked(), false);
  await status.selectOption("missing");
  await expectNames(["Delta Ungrouped", "Epsilon Special"]);
  await status.selectOption("conflict");
  await page.getByRole("combobox", { name: /^Entity/ }).selectOption("Ceneo");
  await expectNames(["Beta Conflict"]);
  await page.getByRole("combobox", { name: /^Current group/ }).selectOption("PM");
  await expectNames([]);
  await page.getByText("No people match these filters.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  assert.equal(await status.inputValue(), "");
  await expectNames(dashboard.members.map((m) => m.name));
  await status.selectOption("conflict");
  await page.getByRole("combobox", { name: /^People API job title/ }).selectOption("Engineer");
  await expectNames(["Alpha Conflict"]);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("absent");
  await expectNames([]);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("Alpha");
  await expectNames(["Alpha Conflict"]);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await status.selectOption("conflict");
  await page.getByRole("button", { name: /Profile needs review/ }).click();
  await expectNames(["Beta Conflict"]);
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Developers", exact: true }) }).getByRole("button", { name: "Manage members", exact: true }).click();
  assert.equal(await status.inputValue(), "");
  await expectNames(["Alpha Conflict", "Beta Conflict", "Gamma Single"]);
  await status.selectOption("conflict");
  await expectNames(["Alpha Conflict", "Beta Conflict"]);
  await mkdir(new URL("../../outputs/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../../outputs/member-status-filters.png", import.meta.url)), fullPage: true });
  assert.deepEqual(writes, []); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log("PASS: membership statuses, combined filters, selection reset, empty state and group navigation; no live writes.");
} finally { await browser.close(); }
