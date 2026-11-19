// Run against a local dev server. All API responses and writes are mocked;
// this must never access real People/OpenAI data or change local saved settings.
// PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs node tests/browser/assignment-drafts.mjs
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = compile(await readFile(new URL("../../app/demo-data.ts", import.meta.url), "utf8"));
const { demoData, demoManagementManagers } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const dashboard = { ...demoData, mode: "cached", workspaceId: "synthetic-draft-test" };
const base = process.env.CODEXLENS_TEST_URL || "http://127.0.0.1:3000";
const manager = demoManagementManagers[0];
const target = dashboard.groups.find((group) => group.name === "Developers");
let rules = { policyVersion: 2, roleToGroups: {}, emailDomainToGroups: {}, entityToGroups: {}, structureRules: [] };
let roleSettings = { revision: "test-1", roles: [] };
let failSave = false;
let failImport = false;
let importReads = 0;
let imported = { lastAttemptAt: "2026-10-20T10:00:00Z", error: null, snapshot: {
  workspaceId: dashboard.workspaceId, syncedAt: "2026-10-20T10:00:00Z",
  roles: [
    { id: "r1", name: "Synthetic Member", description: "Default fixture", predefined: true, inheritsDefault: false, permissions: [{ name: "feature.codex.access", state: "on", editable: true, inheritable: false }] },
    { id: "r2", name: "Synthetic Admin", description: "Custom fixture", predefined: false, inheritsDefault: true, permissions: [{ name: "feature.codex.access", state: "inherit", editable: true, inheritable: true }] },
  ],
  groups: [{ id: "g1", name: "Fixture one", roleIds: ["r1"] }, { id: "g2", name: "Fixture multiple", roleIds: ["r1", "r2"] }, { id: "g3", name: "Fixture empty", roleIds: [] }],
} };
const writes = [];
const unexpected = [];
const errors = [];
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
await page.route("**/*", async (route) => {
  const request = route.request(); const url = new URL(request.url());
  if (url.origin !== new URL(base).origin) { await route.abort(); return; }
  if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
  const respond = (data, status = 200) => route.fulfill({ status, json: data });
  if (request.method() !== "GET") writes.push(`${request.method()} ${url.pathname}`);
  if (url.pathname === "/api/dashboard") return respond(dashboard);
  if (url.pathname === "/api/role-import") {
    if (request.method() === "GET") { importReads++; return respond(imported); }
    imported = { ...imported, lastAttemptAt: "2026-10-21T10:00:00Z", error: failImport ? "Synthetic read permission denied." : null };
    return respond({ ...imported, result: { updated: !failImport, message: "Synthetic import complete." } }, failImport ? 502 : 200);
  }
  if (url.pathname === "/api/sync") {
    dashboard.lastSyncedAt = new Date().toISOString();
    imported = { ...imported, error: null, snapshot: { ...imported.snapshot, syncedAt: dashboard.lastSyncedAt, groups: [...imported.snapshot.groups, { id: "g4", name: "Fixture after sync", roleIds: ["r2"] }] } };
    return respond({ dashboard, changesCreated: 0, sync: { directory: { members: dashboard.members.length, groups: dashboard.groups.length }, roleImport: { updated: true, message: "Synthetic role sync complete." }, usageHistory: { message: "Synthetic usage." } } });
  }
  if (url.pathname === "/api/sync-settings") return respond({ settings: { enabled: false, intervalMinutes: 15 }, state: { status: "idle", lastSuccessAt: null, changes: 0, error: null } });
  if (url.pathname === "/api/organizer-mappings") {
    if (request.method() === "PATCH") {
      if (failSave) return respond({ error: "Synthetic save failure. Draft retained." }, 409);
      rules = request.postDataJSON();
      delete rules.expectedRevision;
    }
    return respond(rules);
  }
  if (url.pathname === "/api/management-managers") return respond({ managers: [manager], truncated: false });
  if (url.pathname === "/api/organizer-structure") return respond({
    members: {}, retrievedAt: new Date().toISOString(), error: null,
    rulesKey: JSON.stringify(rules.structureRules), directoryKey: JSON.stringify(dashboard.members.map((m) => [m.id, m.email]).sort()),
  });
  if (url.pathname === "/api/role-group-mappings") {
    if (request.method() === "PATCH") roleSettings = { roles: request.postDataJSON().roles, revision: "test-2" };
    return respond(roleSettings);
  }
  unexpected.push(`${request.method()} ${url.pathname}`);
  return respond({ error: "Unmocked API blocked by test" }, 500);
});
const nav = (label) => page.getByRole("navigation").getByRole("button", { name: label, exact: true }).click();
try {
  await page.goto(`${base}/?view=organize`);
  await page.getByText("Last saved snapshot", { exact: true }).waitFor();
  const picker = page.getByRole("textbox", { name: "Find structure manager" });
  await picker.fill("David");
  await page.getByRole("button", { name: "Search People API", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(manager.name) }).click();
  await page.getByLabel("Structure rule destination", { exact: true }).selectOption(target.id);

  // Even unfinished form inputs must survive navigation.
  await nav("Permissions & roles");
  await page.getByText("Fixture one", { exact: true }).waitFor();
  await page.getByLabel("Show assignments", { exact: true }).selectOption("multiple");
  await page.getByText("Fixture multiple", { exact: true }).waitFor();
  assert.equal(await page.getByText("Fixture one", { exact: true }).count(), 0);
  await page.getByLabel("Show assignments", { exact: true }).selectOption("unassigned");
  await page.getByText("Fixture empty", { exact: true }).waitFor();
  await page.getByLabel("Show assignments", { exact: true }).selectOption("all");
  await page.getByLabel("Search imported configuration", { exact: true }).fill("Admin");
  assert.equal(await page.getByText("Fixture one", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "View Synthetic Admin permissions", exact: true }).click();
  await page.getByRole("heading", { name: "Synthetic Admin · permission states", exact: true }).waitFor();
  await page.getByRole("cell", { name: "inherit", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close permission details", exact: true }).click();
  await page.getByLabel("Search imported configuration", { exact: true }).fill("");
  await page.getByRole("button", { name: "Local mapping plan", exact: true }).click();
  await page.getByText("Local planning only", { exact: true }).waitFor();
  await page.getByText("No local role references registered", { exact: true }).waitFor();
  await nav("Organize");
  assert.equal(await picker.inputValue(), manager.name);
  assert.equal(await page.getByLabel("Structure rule destination", { exact: true }).inputValue(), target.id);
  await page.getByRole("button", { name: "Add structure rule", exact: true }).click();
  await page.getByText("Unsaved assignment rules", { exact: true }).waitFor();
  assert.equal(rules.structureRules.length, 0, "Adding a draft must not save it silently");

  await nav("Permissions & roles");
  await page.getByLabel("Existing OpenAI role name").fill("Synthetic role");
  await page.getByRole("button", { name: "Register role reference", exact: true }).click();
  await page.getByText("Unsaved local mapping draft", { exact: true }).waitFor();
  await nav("Organize");
  await page.getByRole("button", { name: `Remove rule for ${manager.name}`, exact: true }).waitFor();
  assert.equal(writes.length, 0, "Switching tabs must not save or change access");
  const beforeUnload = await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  assert.equal(beforeUnload, true, "Warn before reloading unsaved drafts, even hidden ones");

  failSave = true;
  await page.getByRole("button", { name: "Save rules", exact: true }).first().click();
  await page.getByRole("alert").filter({ hasText: "Synthetic save failure" }).waitFor();
  await nav("Permissions & roles");
  await page.getByText("Synthetic role", { exact: true }).waitFor();
  await nav("Organize");
  await page.getByRole("button", { name: `Remove rule for ${manager.name}`, exact: true }).waitFor();
  assert.equal(rules.structureRules.length, 0);
  failSave = false;
  await page.getByRole("button", { name: "Save rules", exact: true }).first().click();
  await page.getByText("Assignment rules saved locally.", { exact: false }).waitFor();
  assert.equal(rules.structureRules[0].managerId, manager.id);
  await page.getByText("Unsaved assignment rules", { exact: true }).waitFor({ state: "hidden" });

  await nav("Permissions & roles");
  await page.getByRole("button", { name: "Review mapping changes", exact: true }).click();
  await page.getByRole("button", { name: "Save local mapping plan", exact: true }).click();
  await page.getByText("1 saved local role reference", { exact: true }).waitFor();
  await page.getByText("Unsaved local mapping draft", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true }))), true);

  // Role-only import failure retains the complete snapshot and cannot overwrite plans.
  await page.getByLabel("Existing OpenAI role name").fill("Retain this draft");
  await page.getByRole("button", { name: "Current OpenAI configuration", exact: true }).click();
  failImport = true;
  await page.getByRole("button", { name: "Refresh from OpenAI", exact: true }).click();
  await page.getByText("Import not current · last complete snapshot retained", { exact: true }).waitFor();
  await page.getByText("Fixture one", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Local mapping plan", exact: true }).click();
  assert.equal(await page.getByLabel("Existing OpenAI role name").inputValue(), "Retain this draft");
  const readsBeforeSync = importReads;
  await page.getByRole("button", { name: "Sync directory", exact: true }).click();
  await page.getByText("Synthetic role sync complete.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Current OpenAI configuration", exact: true }).click();
  await page.getByText("Fixture after sync", { exact: true }).waitFor();
  assert.ok(importReads > readsBeforeSync, "Directory sync reloads imported roles");
  assert.equal(await page.getByText("Import not current · last complete snapshot retained", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "By role", exact: true }).click();
  await page.getByRole("cell", { name: "Synthetic Admin Custom role · inherits default member role", exact: true }).waitFor();
  await mkdir(new URL("../../outputs/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../../outputs/permissions-source-status.png", import.meta.url)), fullPage: true });
  await page.getByRole("button", { name: "Local mapping plan", exact: true }).click();
  assert.equal(await page.getByLabel("Existing OpenAI role name").inputValue(), "Retain this draft");
  await page.getByLabel("Existing OpenAI role name").fill("");

  await page.reload();
  await page.getByText("Last saved snapshot", { exact: true }).waitFor();
  await page.getByRole("button", { name: `Remove rule for ${manager.name}`, exact: true }).waitFor();
  assert.equal(await page.getByText("Unsaved assignment rules", { exact: true }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL("../../outputs/structure-manager-included.png", import.meta.url)), fullPage: true });
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, ["PATCH /api/organizer-mappings", "PATCH /api/organizer-mappings", "PATCH /api/role-group-mappings", "POST /api/role-import", "POST /api/sync"]);
  console.log("PASS: manager picker and drafts survive tab changes; failed saves retain drafts; explicit saves reload; role source is clear; no live API writes.");
} finally { await browser.close(); }
