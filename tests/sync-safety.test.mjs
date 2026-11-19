import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

// All storage is disposable in-memory SQLite. No workspace database or network.
const databaseUrl = url(`
import { DatabaseSync } from "node:sqlite";
export const sqlite = new DatabaseSync(":memory:");
function prepare(sql, args = []) { return {
  bind(...values) { return prepare(sql, values); },
  async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  execute() { const result=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(result.changes)}}; },
  async run() { return this.execute(); }
}; }
export const env = { DB: { prepare, async batch(statements) {
  sqlite.exec('BEGIN');
  try { const result=statements.map(s=>s.execute()); sqlite.exec('COMMIT'); return result; }
  catch(error) { sqlite.exec('ROLLBACK'); throw error; }
} } };
export const classifyPeopleRoleFamily = () => "Other";
export const validateExclusiveSets = () => [];
export const validateAccessRules = value => value;
export const displayWorkspaceRole = () => "Member";
`);
const changesUrl = url(compile(await source("../lib/change-filters.ts")));
const storeUrl = url(compile((await source("../db/store.ts"))
  .replace('from "cloudflare:workers"', `from "${databaseUrl}"`)
  .replace(/from "\.\.\/lib\/(?:role-families|access-review|workspace-roles|access-policy)"/g, `from "${databaseUrl}"`)
  .replace('from "../lib/change-filters"', `from "${changesUrl}"`)));
const store = await import(storeUrl);
const locks = await import(url(compile((await source("../db/access-store.ts")).replace('from "./store"', `from "${storeUrl}"`))));
const { sqlite } = await import(databaseUrl);

test("workspace lock is exclusive, owner-bound, renewable and recoverable after expiry", async () => {
  assert.equal(await locks.acquireWorkspaceLock("w", "first"), true);
  assert.equal(await locks.acquireWorkspaceLock("w", "second"), false);
  await locks.releaseWorkspaceLock("w", "second");
  assert.equal(await locks.acquireWorkspaceLock("w", "second"), false);
  await locks.renewWorkspaceLock("w", "first");
  sqlite.prepare("UPDATE workspace_locks SET expires_at=0 WHERE name='w'").run();
  await assert.rejects(locks.renewWorkspaceLock("w", "first"), /expired/);
  assert.equal(await locks.acquireWorkspaceLock("w", "second"), true);
  await locks.releaseWorkspaceLock("w", "second");
});

test("review plans cannot cross workspaces, expire, and can be claimed only once", async () => {
  await locks.saveAccessPlan("p", "w", {safe:true}, Date.now()+60_000);
  await assert.rejects(locks.claimAccessPlan("p", "other"));
  assert.deepEqual(await locks.claimAccessPlan("p", "w"), {safe:true});
  await assert.rejects(locks.claimAccessPlan("p", "w"));
  await locks.saveAccessPlan("expired", "w", {}, Date.now()-1);
  await assert.rejects(locks.claimAccessPlan("expired", "w"));
});

test("a failed snapshot rolls back members, memberships, events and the success record together", async () => {
  const snapshot={members:[{id:"u",name:"Synthetic Person",email:"test@example.com",workspaceRole:"Member",peopleRole:"Engineer",department:"Tech",manager:null,entity:"Allegro",status:"Active",peopleMatch:"Matched"}],groups:[{id:"g",name:"Developers",source:"Manual",description:""}],memberships:[{memberId:"u",groupId:"g"}]};
  await store.saveSnapshot(snapshot,"ok","2026-10-01T00:00:00Z");
  const bad={...snapshot,members:[{...snapshot.members[0],peopleRole:"Changed"}],memberships:[...snapshot.memberships,...snapshot.memberships]};
  await assert.rejects(store.saveSnapshot(bad,"failed","2026-10-02T00:00:00Z"));
  assert.equal(sqlite.prepare("SELECT people_role FROM members WHERE id='u'").get().people_role,"Engineer");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM memberships").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM change_events").get().n,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sync_runs WHERE id='failed'").get().n,0);
  await store.saveSnapshot({...snapshot,members:[{...snapshot.members[0],peopleMatch:"Stale"}]},"stale","2026-10-03T00:00:00Z");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM change_events WHERE action='People API profile changed'").get().n,1);
});

test("structure, scoped title and person rules round-trip without changing memberships",async()=>{
  const before=sqlite.prepare("SELECT COUNT(*) AS n FROM memberships").get().n;
  assert.deepEqual((await store.getOrganizerMappings()).structureRules,[]);
  const structureRules=[{managerId:"synthetic-leader",managerName:"Synthetic Leader",managerEmail:"leader@example.com",groupId:"g"}];
  await store.saveOrganizerMappings({policyVersion:2,roleToGroups:{Engineer:["g"]},roleToGroupsInLeaderStructure:{Engineer:[]},roleToGroupsOutsideLeaderStructure:{Engineer:["g"]},entityToGroups:{},emailDomainToGroups:{},structureRules,memberOverrides:{u:"g"}});
  assert.deepEqual((await store.getOrganizerMappings()).structureRules,structureRules);
  assert.deepEqual((await store.getOrganizerMappings()).roleToGroups,{Engineer:["g"]});
  assert.deepEqual((await store.getOrganizerMappings()).roleToGroupsInLeaderStructure,{Engineer:[]});
  assert.deepEqual((await store.getOrganizerMappings()).roleToGroupsOutsideLeaderStructure,{Engineer:["g"]});
  assert.deepEqual((await store.getOrganizerMappings()).memberOverrides,{u:"g"});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM memberships").get().n,before);
});

test("unified usage supersedes Codex-only rows and retains former members without inventing invoice spend", async () => {
  const day = { periodStart: "2026-10-04", periodEnd: "2026-10-04", messages: 2, unit: "credits" };
  await store.importUsage([{ ...day, memberId: "u", amount: 50 }], "Codex Analytics API");
  await store.importUsage([
    { ...day, memberId: "u", amount: 100, estimatedCostUsd: 4 },
    { ...day, memberId: "former-account", amount: 30, estimatedCostUsd: 1.2 },
  ], "Unified Usage API");
  const analytics = await store.getAnalytics({ startDate: "2026-10-04", endDate: "2026-10-04", bucket: "day" });
  assert.equal(analytics.totals.usage, 130);
  assert.equal(analytics.totals.usageValue, 5.2);
  assert.equal(analytics.valuationBasis, "api-estimate");
  assert.equal(analytics.totals.activeUsers, 2);
  assert.equal(analytics.totals.currentActiveUsers, 1);
  assert.equal(analytics.byGroup.find(row => row.id === "g")?.usage, 100);
  assert.equal(analytics.byGroup.find(row => row.id === "__unassigned__")?.usage, 30);
  assert.match(analytics.warning, /former workspace accounts/);
  assert.match(analytics.warning, /not the amount payable on an invoice/);
});

const unifiedStubUrl = url('export const fetchJson = async () => ({})');
const unified = await import(url(compile((await source("../lib/unified-analytics.ts")).replace('from "./http"', `from "${unifiedStubUrl}"`))));
test("unified parser uses daily totals, OpenAI USD estimate and exclusive UTC end", () => {
  const parsed = unified.parseUnifiedUsageRow({
    start_time: 1_780_531_200, end_time: 1_780_617_600,
    user_id: "user-1", actor: { email: "person@example.test" },
    totals: { credits: 12.5, messages: 3, cost_usd: null, estimated_cost_usd: 0.5 },
    clients: [{ credits: 99_999 }],
  });
  assert.equal(parsed?.amount, 12.5);
  assert.equal(parsed?.estimatedCostUsd, 0.5);
  assert.equal(parsed?.reportedCostUsd, null);
  assert.equal(parsed?.periodStart, parsed?.periodEnd);
  assert.equal(unified.parseUnifiedUsageRow({ start_time: 1, end_time: 2, user_id: "u", totals: {} }), null);
});

const syncStubUrl = url(`
export const state={snapshot:null,usageDays:[],released:0,locked:false,outage:true,saves:0,roleImports:0};
export const syncWorkspaceRoles=async()=>{state.roleImports++;return {updated:true,roles:2,groups:1,message:'Imported roles'};};
export const getWorkspaceConfig=()=>({adminKey:'test-only',workspaceId:'w',workspaceName:'Synthetic',openAiBaseUrl:'https://invalid.example',peopleBaseUrl:'https://invalid.example',analyticsHistoryDays:365});
export const acquireWorkspaceLock=async()=>!state.locked;
export const renewWorkspaceLock=async()=>{};
export const releaseWorkspaceLock=async()=>{state.released++;};
export const getDashboard=async()=>({members:[{id:'u',peopleRole:'Engineer',department:'Tech',manager:'Synthetic Manager',entity:'Ceneo'}]});
export const saveSnapshot=async snapshot=>{state.snapshot=snapshot;state.saves++;return 2;};
export const saveFailedSync=async()=>{};
export const importUsage=async()=>({imported:1,unmatched:0});
export const codexAnalyticsError=()=> 'Usage unavailable';
export const listDailyCodexUsage=async(_b,_w,_k,days)=>{state.usageDays.push(days);return {rows:[],fetched:1,startDate:'2026-10-01',endDate:'2026-10-07'};};
export const listDailyUnifiedUsage=async(_b,_w,_k,days)=>{state.usageDays.push(days);return {rows:[],fetched:1,startDate:'2026-10-01',endDate:'2026-10-07'};};
export const mapWithConcurrency=async(values,_n,fn)=>Promise.all(values.map(fn));
export const listWorkspaceUsers=async()=>[{id:'u',email:'test@example.com',role:'member',status:'active'}];
export const listWorkspaceGroups=async()=>[{id:'admin',name:'admin'}];
export const listGroupUsers=async()=>[{id:'u'}];
export const workspaceUserAddition=()=>({});
export const findPersonByEmail=async()=>{if(state.outage)throw new Error('unavailable');return {profile:null,match:'Missing'};};
export const entityFromCompany=()=> 'Unknown';
export const displayWorkspaceRole=()=> 'Member';
`);
const directory = await import(url(compile((await source("../lib/directory-sync.ts")).replace(/from "\.\.\/(?:db|lib)\/[^"]+"/g, `from "${syncStubUrl}"`))));
const { state } = await import(syncStubUrl);

test("directory sync retains enrichment on People API outage and never changes upstream memberships", async () => {
  const result=await directory.runDirectorySync("none");
  assert.equal(result.sync.roleImport.updated,true);
  assert.equal(state.roleImports,1);
  assert.equal(result.sync.directory.staleProfiles,1);
  assert.equal(state.snapshot.members[0].peopleMatch,"Stale");
  assert.equal(state.snapshot.members[0].peopleRole,"Engineer");
  assert.equal(state.snapshot.members[0].entity,"Ceneo");
  assert.deepEqual(state.snapshot.memberships,[{memberId:"u",groupId:"admin"}]);
  assert.deepEqual(state.usageDays,[]);
  assert.equal(state.released,1);
  state.outage=false;
  await directory.runDirectorySync("incremental");
  assert.equal(state.snapshot.members[0].peopleMatch,"Missing");
  assert.equal(state.snapshot.members[0].peopleRole,null);
  await directory.runDirectorySync("full");
  assert.deepEqual(state.usageDays,[7,365]);
  const saves=state.saves;state.locked=true;
  await assert.rejects(directory.runDirectorySync(),/already running/);
  assert.equal(state.saves,saves);
});

const settingsUrl = url(compile(await source("../lib/sync-settings.ts")));
const runnerStubUrl = url(`
export const runner={settings:{enabled:false,intervalMinutes:15},state:null,runs:[],writes:new Map(),fail:false,roleFailure:false};
export const value=()=> 'synthetic-token';
export const getWorkspaceConfig=()=>({workspaceId:'w'});
export const acquireWorkspaceLock=async()=>true;
export const releaseWorkspaceLock=async()=>{};
export const readLocalSetting=async(key,fallback)=>key.startsWith('sync-settings:')?runner.settings:runner.state??fallback;
export const writeLocalSetting=async(key,v)=>{runner.writes.set(key,v);if(key==='sync-state:w')runner.state=v;};
export const runDirectorySync=async(mode)=>{runner.runs.push(mode);if(runner.fail)throw new Error('Synthetic outage');return {changesCreated:3,sync:{directory:{staleProfiles:0},usageHistory:{updated:mode!=='none'},roleImport:{updated:!runner.roleFailure,message:'Synthetic role import failure'}}};};
`);
const runnerRoute=await import(url(compile((await source("../app/api/auto-sync/route.ts"))
  .replace(/from "\.\.\/\.\.\/\.\.\/(?:db\/access-store|lib\/config|lib\/directory-sync)"/g,`from "${runnerStubUrl}"`)
  .replace('from "../../../lib/sync-settings"',`from "${settingsUrl}"`))));
const {runner}=await import(runnerStubUrl);
const tick=(token="synthetic-token")=>runnerRoute.POST(new Request("http://localhost/api/auto-sync",{method:"POST",headers:{"x-codexlens-sync-token":token}}));
test("background scheduler authenticates, honors pause/due time, and refreshes usage hourly",async()=>{
  assert.equal((await tick("wrong")).status,403);
  assert.equal((await tick("é".repeat(15))).status,403);
  assert.equal((await tick()).status,200);assert.deepEqual(runner.runs,[]);
  runner.settings.enabled=true;
  await tick();assert.deepEqual(runner.runs,["incremental"]);
  await tick();assert.equal(runner.runs.length,1);
  runner.state.nextRunAt=null;
  await tick();assert.deepEqual(runner.runs,["incremental","none"]);
  runner.state.nextRunAt=null;runner.roleFailure=true;
  await tick();assert.equal(runner.state.status,"partial");
  assert.match(runner.state.error,/role import failure/);
  runner.roleFailure=false;
  runner.state.nextRunAt=null;runner.fail=true;
  assert.equal((await tick()).status,500);
  assert.equal(runner.state.status,"failed");
  assert.ok(Date.parse(runner.state.nextRunAt)>Date.now());
});
