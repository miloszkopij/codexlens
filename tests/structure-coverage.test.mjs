import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = await readFile(new URL("../lib/structure-coverage.ts", import.meta.url), "utf8");
const { calculateStructureCoverage } = await import(url(compile(source)));
const person = (id, manager, extra = {}) => ({ id, displayName: id, email: `${id}@allegro.example`, company: "Allegro", isActive: true, manager: manager ? { id: manager } : null, ...extra });
const member = (id, seatType = "chatgpt", extra = {}) => ({ id: `w-${id}`, email: `${id}@allegro.example`, seatType, ...extra });
const people = [person("root"), person("david", "root"), person("peer", "root", { isActive: false }), person("manager", "david"), person("engineer", "manager"), person("analyst", "engineer"), person("ceneo", "peer", { company: "Ceneo", email: "ceneo@ceneo.example" }), person("former", "manager", { isActive: false })];
const members = [member("david"), member("engineer", "codex"), member("analyst", "unknown"), member("ceneo", "chatgpt", { email: " CENEO@CENEO.EXAMPLE " }), member("former")];
const base = (extra = {}) => ({ people, members, rootId: "root", activeUserIds: new Set(["w-engineer"]), ...extra });

test("covers all reporting levels once, includes leaders, and traverses inactive managers", () => {
  const result = calculateStructureCoverage(base());
  assert.deepEqual(result.totals, { totalPeople: 5, workspacePeople: 4, chatgptSeats: 2, codexSeats: 1, unknownSeats: 1, activeUsers: 1 });
  const david = result.rows.find((r) => r.id === "david");
  assert.equal(david.totalPeople, 4);
  assert.equal(david.workspacePeople, 3);
  assert.equal(david.coverage, .75);
  const peer = result.rows.find((r) => r.id === "peer");
  assert.equal(peer.leaderActive, false);
  assert.equal(peer.totalPeople, 1);
  assert.equal(peer.workspacePeople, 1);
  assert.equal(result.quality.inactive, 1);
});

test("entity filters both sides while group filters only workspace numerator and activity", () => {
  const entity = calculateStructureCoverage(base({ entity: "Ceneo" }));
  assert.equal(entity.totals.totalPeople, 1);
  assert.equal(entity.totals.workspacePeople, 1);
  assert.equal(entity.rows.find((r) => r.id === "david").coverage, null);
  const group = calculateStructureCoverage(base({ groupMemberIds: new Set(["w-engineer"]) }));
  assert.equal(group.totals.totalPeople, 5);
  assert.equal(group.totals.workspacePeople, 1);
  assert.equal(group.totals.activeUsers, 1);
  assert.equal(calculateStructureCoverage(base({ groupMemberIds: new Set() })).totals.workspacePeople, 0);
});

test("period activity never changes current headcount or membership", () => {
  const current = calculateStructureCoverage(base());
  const earlier = calculateStructureCoverage(base({ activeUserIds: new Set() }));
  assert.equal(earlier.totals.activeUsers, 0);
  assert.deepEqual({ ...earlier.totals, activeUsers: 1 }, current.totals);
});

test("excludes ambiguous email joins and duplicate workspace accounts instead of guessing", () => {
  const ambiguous = calculateStructureCoverage(base({ people: [...people, person("alias", "david", { email: "engineer@allegro.example" })] }));
  assert.equal(ambiguous.quality.ambiguous, 1);
  assert.equal(ambiguous.totals.activeUsers, 0);
  const duplicate = calculateStructureCoverage(base({ members: [...members, member("second-account", "chatgpt", { email: "engineer@allegro.example" })] }));
  assert.equal(duplicate.quality.duplicateAccounts, 2);
  assert.equal(duplicate.totals.workspacePeople, 3);
});

test("reports unmatched emails and broken/cyclic manager paths without looping", () => {
  const result = calculateStructureCoverage(base({ people: [...people, person("orphan", "missing"), person("cycle-a", "cycle-b"), person("cycle-b", "cycle-a")], members: [...members, member("orphan"), member("cycle-a"), member("unmatched"), member("root")] }));
  assert.equal(result.quality.unresolvedDirectoryPeople, 3);
  assert.equal(result.quality.brokenHierarchy, 2);
  assert.equal(result.quality.unmatched, 1);
  assert.equal(result.quality.outside, 1);
  assert.equal(result.totals.totalPeople, 5);
});

test("rejects incomplete identity directories and treats missing active flags as unverified", () => {
  assert.throws(() => calculateStructureCoverage(base({ people: people.slice(1) })), /root manager/);
  assert.throws(() => calculateStructureCoverage(base({ people: [...people, people[1]] })), /duplicate IDs/);
  assert.throws(() => calculateStructureCoverage(base({ people: [...people, {}] })), /missing/);
  const result = calculateStructureCoverage(base({ people: [...people, person("pending", "david", { isActive: undefined })], members: [...members, member("pending")] }));
  assert.equal(result.totals.totalPeople, 5);
  assert.equal(result.quality.inactive, 2);
});

test("coverage route rejects invalid ranges before calling external directories", async () => {
  const stub = url(`export const getAnalytics = () => { throw new Error("must not execute"); }; export const getDashboard = getAnalytics; export const getWorkspaceConfig = getAnalytics; export const findPersonByDisplayName = getAnalytics; export const getDirectorySnapshot = getAnalytics; export const profileId = getAnalytics; export const listWorkspaceUsers = getAnalytics; export const roleMember = getAnalytics; export const calculateStructureCoverage = getAnalytics;`);
  let route = await readFile(new URL("../app/api/structure-coverage/route.ts", import.meta.url), "utf8");
  route = route.replace(/from "(?:\.\.\/){3}(?:db\/store|lib\/(?:config|people-api|openai-admin|structure-coverage))"/g, `from "${stub}"`);
  const { GET } = await import(url(compile(route)));
  for (const params of ["", "start=2026-02-30&end=2026-03-01", "start=2026-10-02&end=2026-10-01", "start=2026-09-01&end=2026-09-30&entity=wrong"]) assert.equal((await GET(new Request(`http://localhost/api/structure-coverage?${params}`))).status, 400);
});
