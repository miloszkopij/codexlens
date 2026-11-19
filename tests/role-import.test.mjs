import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const url = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const compile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const modelUrl = url(compile(await source("../lib/role-import.ts")));
const { parseImportedRole, roleImportError } = await import(modelUrl);
const rawRole = (id = "r1") => ({ id, name: `Role ${id}`, description: null, predefined_role: false, inherits_from_default_member_role: true,
  permission_states: [{ name: "feature.access", state: "inherit", editable: true, inheritable: true }] });
const group = { id: "g1", name: "Synthetic group" };
const httpUrl = url(`
export const network={responses:[],calls:[]};
export async function fetchJson(url,options){network.calls.push({url,options});const next=network.responses.shift();if(next instanceof Error)throw next;if(next===undefined)throw new Error('Unexpected request');return next;}
`);
const { network } = await import(httpUrl);
const clientUrl = url(compile((await source("../lib/openai-roles.ts")).replace('from "./http"', `from "${httpUrl}"`).replace('from "./role-import"', `from "${modelUrl}"`)));
const { fetchWorkspaceRoleSnapshot } = await import(clientUrl);
const roles = (items = [rawRole()]) => ({ object: "list", data: items });
const reset = (...responses) => { network.responses = responses; network.calls = []; };
const fetchSnapshot = (groups = [group]) => fetchWorkspaceRoleSnapshot("https://api.example.test/v1", "workspace/encoded", "synthetic", groups);

test("role parser retains permission inheritance and rejects incomplete data", () => {
  const role = parseImportedRole(rawRole());
  assert.equal(role.inheritsDefault, true);
  assert.deepEqual(role.permissions, [{ name: "feature.access", state: "inherit", editable: true, inheritable: true }]);
  for (const invalid of [null, {}, { ...rawRole(), permission_states: {} }, { ...rawRole(), predefined_role: undefined }, { ...rawRole(), permission_states: [{ name: "x" }] }, { ...rawRole(), permission_states: [...rawRole().permission_states, ...rawRole().permission_states] }]) assert.throws(() => parseImportedRole(invalid));
  assert.match(roleImportError(Object.assign(new Error("secret upstream body"), { status: 403 })), /read permissions/);
  assert.doesNotMatch(roleImportError(new Error("secret upstream body")), /secret/);
});

test("imports all roles and per-group assignments using only GET; preserves multiple roles", async () => {
  reset(roles([rawRole(), rawRole("r2")]), roles([rawRole(), rawRole("r2")]));
  const snapshot = await fetchSnapshot();
  assert.equal(snapshot.roles.length, 2);
  assert.deepEqual(snapshot.groups, [{ ...group, roleIds: ["r1", "r2"] }]);
  assert.ok(Date.parse(snapshot.syncedAt));
  assert.equal(network.calls.length, 2);
  assert.ok(network.calls.every(({ url, options }) => options.method === "GET" && options.redirect === "manual" && url.includes("workspace%2Fencoded")));
});

test("role pagination follows continuation and refuses duplicates or incomplete pages", async () => {
  reset({ ...roles(), has_more: true, cursor: "next-page" }, roles([rawRole("r2")]), roles([]));
  const snapshot = await fetchSnapshot();
  assert.equal(snapshot.roles.length, 2);
  assert.deepEqual(snapshot.groups[0].roleIds, []);
  assert.equal(new URL(network.calls[1].url).searchParams.get("cursor"), "next-page");
  for (const pages of [[{}], [{ ...roles(), has_more: true }], [{ ...roles(), has_more: true, cursor: "again" }, roles()], [roles(), roles([rawRole("unknown")])], [roles(), new Error("group failed")]]) {
    reset(...pages); await assert.rejects(fetchSnapshot());
  }
});

const workspaceRolesUrl = url(compile(await source("../lib/workspace-roles.ts")));
const adminUrl = url(compile((await source("../lib/openai-admin.ts")).replace('from "./http"', `from "${httpUrl}"`).replace('from "./workspace-roles"', `from "${workspaceRolesUrl}"`)));
const { listWorkspaceGroups } = await import(adminUrl);
test("group pagination cannot silently convert malformed or partial responses to an empty mapping", async () => {
  for (const pages of [[{}], [{ data: null }], [{ data: [group], has_more: true }], [{ data: [group], has_more: true, cursor: "a" }, { data: [group], has_more: false }]]) {
    reset(...pages); await assert.rejects(listWorkspaceGroups("https://api.example.test", "w", "synthetic"));
  }
  reset({ data: [group], has_more: true, cursor: "a" }, { data: [{ id: "g2", name: "Second" }], has_more: false, cursor: "last" });
  assert.equal((await listWorkspaceGroups("https://api.example.test", "w", "synthetic")).length, 2);
});

const storageUrl = url(`
export const storage={values:new Map(),writes:[]};
export const readLocalSetting=async(key,fallback)=>storage.values.get(key)??fallback;
export const writeLocalSetting=async(key,value)=>{storage.values.set(key,value);storage.writes.push(key);};
`);
const { storage } = await import(storageUrl);
const syncUrl = url(compile((await source("../lib/role-sync.ts")).replace('from "../db/access-store"', `from "${storageUrl}"`).replace('from "./openai-roles"', `from "${clientUrl}"`).replace('from "./role-import"', `from "${modelUrl}"`)));
const { syncWorkspaceRoles, readRoleImport } = await import(syncUrl);
const config = { openAiBaseUrl: "https://api.example.test", workspaceId: "w", adminKey: "synthetic" };

test("snapshot commits atomically; failed imports preserve previous state and separate local plans", async () => {
  storage.values.clear(); storage.writes = [];
  const plan = { roles: [{ name: "Unsynced plan" }] };
  storage.values.set("role-group-mappings:w", plan);
  reset(roles(), roles());
  assert.equal((await syncWorkspaceRoles(config, [group], async () => {})).updated, true);
  const first = await readRoleImport("w");
  assert.deepEqual(storage.writes, ["openai-role-import:w"]);
  reset(roles([rawRole("r2")]), Object.assign(new Error("secret"), { status: 403 }));
  assert.equal((await syncWorkspaceRoles(config, [group], async () => {})).updated, false);
  const failed = await readRoleImport("w");
  assert.deepEqual(failed.snapshot, first.snapshot);
  assert.match(failed.error, /read permissions/);
  assert.ok(failed.lastAttemptAt);
  assert.equal(storage.values.get("role-group-mappings:w"), plan);
  assert.equal((await readRoleImport("other-workspace")).snapshot, null);
  const listingFailure = await syncWorkspaceRoles(config, async () => { throw new Error("Group list failed"); }, async () => {});
  assert.equal(listingFailure.updated, false);
  assert.deepEqual((await readRoleImport("w")).snapshot, first.snapshot);
  reset(roles(), roles([]));
  await syncWorkspaceRoles(config, [group], async () => {});
  assert.equal((await readRoleImport("w")).error, null);
  assert.deepEqual((await readRoleImport("w")).snapshot.groups[0].roleIds, []);
});

const safetyUrl = url(compile(await source("../lib/request-safety.ts")));
const routeStubsUrl = url(`
export const routeState={locked:false,released:0,imports:0,fail:false};
export const getWorkspaceConfig=()=>({workspaceId:'w',adminKey:'synthetic',openAiBaseUrl:'https://api.example.test'});
export const acquireWorkspaceLock=async()=>!routeState.locked;
export const releaseWorkspaceLock=async()=>{routeState.released++;};
export const renewWorkspaceLock=async()=>{};
export const listWorkspaceGroups=async()=>[];
export const readRoleImport=async()=>({snapshot:null,lastAttemptAt:null,error:null});
export const syncWorkspaceRoles=async(_config,groups,heartbeat)=>{routeState.imports++;await groups();await heartbeat();return {updated:!routeState.fail};};
`);
const route = await import(url(compile((await source("../app/api/role-import/route.ts"))
  .replace(/from "\.\.\/\.\.\/\.\.\/(?:db\/access-store|lib\/config|lib\/openai-admin|lib\/role-sync)"/g, `from "${routeStubsUrl}"`)
  .replace('from "../../../lib/request-safety"', `from "${safetyUrl}"`))));
const { routeState } = await import(routeStubsUrl);
const request = (origin = "http://localhost") => new Request("http://localhost/api/role-import", { method: "POST", headers: { Origin: origin } });
test("import route rejects cross-origin calls and overlapping operations; always releases lock", async () => {
  assert.equal((await route.GET()).status, 200);
  assert.equal(routeState.imports, 0);
  assert.equal((await route.POST(request("https://untrusted.example"))).status, 403);
  assert.equal(routeState.imports, 0);
  routeState.locked = true;
  assert.equal((await route.POST(request())).status, 409);
  assert.equal(routeState.released, 0);
  routeState.locked = false;
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(routeState.released, 1);
  routeState.fail = true;
  assert.equal((await route.POST(request())).status, 502);
  assert.equal(routeState.released, 2);
  assert.deepEqual(Object.keys(route).sort(), ["GET", "POST", "dynamic"]);
});

test("role requests work in the app's Workerd runtime without following redirects", async () => {
  const { Miniflare } = await import("miniflare");
  const model = compile(await source("../lib/role-import.ts"));
  const client = compile((await source("../lib/openai-roles.ts")).replace(/^import .*;\n/gm, ""));
  const script = `${model}\n${client}\n
    let calls = 0;
    async function fetchJson(url, options) {
      const request = new Request(url, options);
      if (request.method !== 'GET' || request.redirect !== 'manual') throw new Error('Unsafe import request');
      calls++; return { data: [] };
    }
    export default { async fetch() {
      const snapshot = await fetchWorkspaceRoleSnapshot('https://api.example.test', 'w', 'synthetic', [{id:'g',name:'Synthetic'}]);
      return Response.json({ calls, snapshot });
    } };
  `;
  const runtime = new Miniflare({ modules: true, script });
  try {
    const response = await runtime.dispatchFetch("http://localhost");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.calls, 2);
    assert.deepEqual(result.snapshot.groups, [{ id: "g", name: "Synthetic", roleIds: [] }]);
  } finally { await runtime.dispose(); }
});
