import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpersUrl = moduleUrl(compile(await readFile(new URL("../lib/change-filters.ts", import.meta.url), "utf8")));
const { classifyChange, matchesChange, changeCounts, changeWhere, parseChangeQuery, changeTypes } = await import(helpersUrl);

test("distinguishes People API job titles from OpenAI roles and does not guess legacy roles", () => {
  assert.equal(classifyChange("People API role changed").value, "people-role");
  assert.equal(classifyChange("Workspace role changed").value, "workspace-role");
  for (const action of ["Role changed", "Some future event", "Joined a group People API"]) assert.equal(classifyChange(action).area, "other");
  for (const action of ["People API role changed", "Department changed", "Manager changed", "Entity changed", "People profile missing"]) assert.equal(matchesChange(action, { area: "people", type: "all" }), true);
  for (const action of ["Workspace role changed", "Member joined", "Status changed"]) assert.equal(matchesChange(action, { area: "people", type: "all" }), false);
  assert.equal(matchesChange("Workspace role changed", { area: "people", type: "workspace-role" }), false);
});

test("keeps full-history area counts, scoped type counts and matching unread counts separate", () => {
  const actions = [{ action: "Manager changed", total: 12, unread: 4 }, { action: "Department changed", total: 3, unread: 1 }, { action: "Workspace role changed", total: 8, unread: 6 }, { action: "Role changed", total: 2, unread: 1 }];
  const counts = changeCounts(actions, { area: "people", type: "manager" });
  assert.equal(counts.allTotal, 25);
  assert.equal(counts.allUnread, 12);
  assert.equal(counts.total, 12);
  assert.equal(counts.unread, 4);
  assert.deepEqual(counts.byArea, { all: 25, people: 15, workspace: 8, other: 2 });
  assert.equal(counts.byType.all, 15);
  assert.equal(counts.byType.department, 3);
  assert.equal(counts.byType["workspace-role"], 0);
});

test("validates query filters and rejects malformed pagination or injected values", () => {
  assert.deepEqual(parseChangeQuery(new URLSearchParams()), { area: "all", type: "all", offset: 0, limit: 50 });
  assert.equal(parseChangeQuery(new URLSearchParams("area=people&type=manager&offset=100")).offset, 100);
  for (const query of ["type=manager' OR 1=1", "area=invalid", "offset=-1", "offset=NaN", "offset=0.5", "offset=9007199254740992", "offset="]) assert.throws(() => parseChangeQuery(new URLSearchParams(query)));
});

test("SQL and client filtering agree for every combination, including unknown events", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, action TEXT NOT NULL)");
  const actions = [...changeTypes.flatMap((type) => type.actions), "Role changed", "Unknown", "Manager changed — extra text"];
  actions.forEach((action, id) => db.prepare("INSERT INTO events VALUES (?, ?)").run(id, action));
  for (const area of ["all", "people", "workspace", "other"]) for (const type of ["all", ...changeTypes.map((item) => item.value)]) {
    const filters = { area, type }; const where = changeWhere(filters);
    const result = db.prepare(`SELECT action FROM events ${where.sql} ORDER BY id`).all(...where.args).map((row) => row.action);
    assert.deepEqual(result, actions.filter((action) => matchesChange(action, filters)), `${area}/${type}`);
    assert.equal(where.sql.includes("Manager changed"), false); // Values are bound, never interpolated.
  }
  db.close();
});

// Exercise the actual store and route with an isolated SQLite database, never
// the local workspace database or any external API.
const databaseUrl = moduleUrl(`
import { DatabaseSync } from "node:sqlite";
export const sqlite = new DatabaseSync(":memory:");
function prepare(sql, args = []) { return {
  bind(...values) { return prepare(sql, values); },
  async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  async run() { return sqlite.prepare(sql).run(...args); }
}; }
export const env = { DB: { prepare } };
export const classifyPeopleRoleFamily = () => "Other";
export const validateExclusiveSets = () => [];
export const validateAccessRules = value => value;
export const displayWorkspaceRole = () => "Member";
`);
let storeSource = await readFile(new URL("../db/store.ts", import.meta.url), "utf8");
storeSource = storeSource.replace('from "cloudflare:workers"', `from "${databaseUrl}"`).replace(/from "\.\.\/lib\/(?:role-families|access-review|workspace-roles|access-policy)"/g, `from "${databaseUrl}"`).replace('from "../lib/change-filters"', `from "${helpersUrl}"`);
const storeUrl = moduleUrl(compile(storeSource));
const { initializeDatabase, getChanges } = await import(storeUrl);
const { sqlite } = await import(databaseUrl);
await initializeDatabase();
for (let i = 0; i < 145; i++) sqlite.prepare("INSERT INTO change_events (id, person, action, detail, kind, created_at) VALUES (?, 'Test Person', ?, 'test', 'member', ?)").run(`e-${String(i).padStart(3, "0")}`, i < 5 ? "Manager changed" : "Member joined", i < 5 ? "2026-09-01T00:00:00Z" : "2026-10-01T00:00:00Z");

test("filters full history before pagination so People API events older than 100 remain visible", async () => {
  const page = await getChanges({ area: "people", type: "all", offset: 0, limit: 50 });
  assert.equal(page.total, 5);
  assert.equal(page.allTotal, 145);
  assert.equal(page.changes.length, 5);
  assert.ok(page.changes.every((change) => change.action === "Manager changed"));
  assert.equal(page.unread, 5);
});

test("paginates deterministically and clamps pages that no longer exist", async () => {
  const first = await getChanges({ area: "all", type: "all", offset: 0, limit: 50 });
  const second = await getChanges({ area: "all", type: "all", offset: 50, limit: 50 });
  assert.equal(first.changes.length, 50);
  assert.equal(second.changes.length, 50);
  assert.equal(new Set([...first.changes, ...second.changes].map((row) => row.id)).size, 100);
  const last = await getChanges({ area: "all", type: "all", offset: 10000, limit: 50 });
  assert.equal(last.offset, 100);
  assert.equal(last.changes.length, 45);
  const empty = await getChanges({ area: "people", type: "entity", offset: 50, limit: 50 });
  assert.equal(empty.offset, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.changes.length, 0);
});

test("changes API returns filtered data and rejects invalid filters", async () => {
  let routeSource = await readFile(new URL("../app/api/changes/route.ts", import.meta.url), "utf8");
  routeSource = routeSource.replace('from "../../../db/store"', `from "${storeUrl}"`).replace('from "../../../lib/change-filters"', `from "${helpersUrl}"`);
  const { GET } = await import(moduleUrl(compile(routeSource)));
  const response = await GET(new Request("http://localhost/api/changes?area=people&type=manager"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 5);
  assert.equal((await GET(new Request("http://localhost/api/changes?type=unknown"))).status, 400);
});
