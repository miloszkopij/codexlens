import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpersUrl = url(compile(await readFile(new URL("../lib/workspace-roles.ts", import.meta.url), "utf8")));
const { validateRoleChange, displayWorkspaceRole } = await import(helpersUrl);
const change = { memberId: "u1", role: "admin", expectedRole: "member" };

test("preserves Analytics Viewer and unknown roles instead of downgrading to Member", () => {
  assert.equal(displayWorkspaceRole("analytics_viewer"), "Analytics Viewer");
  assert.equal(displayWorkspaceRole("owner"), "Owner");
  assert.equal(displayWorkspaceRole("custom_role"), "Unknown");
});

test("allows only explicitly reviewed built-in role changes", () => {
  assert.deepEqual(validateRoleChange(change), change);
  for (const invalid of [null, [], {}, { ...change, role: "custom" }, { ...change, expectedRole: "custom" }, { ...change, memberId: " " }, { ...change, role: "member" }, { ...change, seat_type: "codex" }, { ...change, permissions: ["*:*:*"] }]) assert.throws(() => validateRoleChange(invalid));
});

// No real credentials or network calls: simulate all dependencies in memory.
const stubs = url(`
export const state = { role: "member", owners: 2, calls: [], verify: true, stored: true, reject: false, auditFails: false };
export const getWorkspaceConfig = () => ({ adminKey: "test-only", workspaceId: "w1", openAiBaseUrl: "https://invalid.example" });
export const getStoredMember = async () => state.stored ? { id: "u1" } : null;
export const getWorkspaceUser = async () => { state.calls.push("read"); return { id: "u1", role: state.role }; };
export const listWorkspaceUsers = async () => { state.calls.push("list"); return Array.from({ length: state.owners }, (_, i) => ({ id: "o"+i, role: "owner" })); };
export const roleMember = (member) => member;
export const updateWorkspaceUserRole = async (...args) => { state.calls.push(["write", args[4]]); if(state.reject) throw Object.assign(new Error("forbidden"), { status: 403 }); if(state.verify) state.role = args[4]; };
export const recordWorkspaceRoleChange = async (...args) => { state.calls.push(["audit", ...args]); if(state.auditFails) throw new Error("storage unavailable"); };
export const getChatGPTUser = async () => null;
`);
let routeSource = await readFile(new URL("../app/api/workspace-roles/route.ts", import.meta.url), "utf8");
routeSource = routeSource.replace(/from "(?:\.\.\/){2,3}(?:lib\/config|lib\/openai-admin|db\/store|chatgpt-auth)"/g, `from "${stubs}"`).replace('from "../../../lib/workspace-roles"', `from "${helpersUrl}"`);
const { POST } = await import(url(compile(routeSource)));
const { state } = await import(stubs);
const reset = (extra = {}) => Object.assign(state, { role: "member", owners: 2, calls: [], verify: true, stored: true, reject: false, auditFails: false }, extra);
const request = (body = change, headers = {}) => new Request("http://localhost/api/workspace-roles", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("rejects cross-site and non-JSON permission changes before reading or writing", async () => {
  reset();
  assert.equal((await POST(request(change, { Origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await POST(request(change, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await POST(request(change, { "Content-Type": "text/plain" }))).status, 415);
  assert.deepEqual(state.calls, []);
});

test("refuses unsynced users and stale role previews without writes", async () => {
  reset({ stored: false });
  assert.equal((await POST(request())).status, 409);
  assert.deepEqual(state.calls, []);
  reset({ role: "owner" });
  assert.equal((await POST(request())).status, 409);
  assert.deepEqual(state.calls, ["read"]);
});

test("protects the last owner and permits reviewed changes when another owner remains", async () => {
  reset({ role: "owner", owners: 1 });
  const demotion = { ...change, expectedRole: "owner" };
  assert.equal((await POST(request(demotion))).status, 422);
  assert.deepEqual(state.calls, ["read", "list"]);
  reset({ role: "owner" });
  assert.equal((await POST(request(demotion))).status, 200);
  assert.deepEqual(state.calls, ["read", "list", ["write", "admin"], "read", ["audit", "u1", "owner", "admin", undefined]]);
});

test("writes once, verifies before audit, and rejects a duplicate stale submission", async () => {
  reset();
  assert.equal((await POST(request())).status, 200);
  assert.deepEqual(state.calls, ["read", ["write", "admin"], "read", ["audit", "u1", "member", "admin", undefined]]);
  state.calls = [];
  assert.equal((await POST(request())).status, 409);
  assert.deepEqual(state.calls, ["read"]);
});

test("unverified writes are not audited and owner/scopes errors remain actionable", async () => {
  reset({ verify: false });
  assert.equal((await POST(request())).status, 500);
  assert.deepEqual(state.calls, ["read", ["write", "admin"], "read"]);
  reset({ reject: true });
  const denied = await POST(request());
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /workspace-owner/);
  assert.deepEqual(state.calls, ["read", ["write", "admin"]]);
  reset({ auditFails: true });
  const audit = await POST(request());
  assert.equal(audit.status, 500);
  assert.match((await audit.json()).error, /changed and verified.*audit/);
});

test("OpenAI role client sends only role, uses encoded IDs, and disables automatic retries", async () => {
  const httpStub = url(`export const calls = []; export const fetchJson = async (...args) => { calls.push(args); return {}; };`);
  let client = await readFile(new URL("../lib/openai-admin.ts", import.meta.url), "utf8");
  client = client.replace('from "./http"', `from "${httpStub}"`).replace('from "./workspace-roles"', `from "${helpersUrl}"`);
  const { updateWorkspaceUserRole, roleMember } = await import(url(compile(client)));
  const { calls } = await import(httpStub);
  await updateWorkspaceUserRole("https://invalid.example", "w/1", "u/1", "test-only", "analytics_viewer");
  assert.equal(calls[0][0], "https://invalid.example/manage/workspaces/w%2F1/users/u%2F1");
  assert.deepEqual(JSON.parse(calls[0][1].body), { role: "analytics_viewer" });
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][2], 1);
  assert.equal(roleMember({ id: "u" }).seatType, "unknown");
});
