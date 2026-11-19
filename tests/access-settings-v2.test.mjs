import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`);
const roles = await load("../lib/role-group-mappings.ts");
const sync = await load("../lib/sync-settings.ts");
test("role-group records are local plans; clients cannot forge manual confirmation", () => {
  const input={id:"r",name:"Existing role",externalId:"external",groupIds:["g"],confirmedAt:"forged",confirmedGroupIds:["g"]};
  const [saved]=roles.validateRoleGroupMappings([input],new Set(["g"]),[]);
  assert.equal(saved.confirmedAt,null); assert.equal(roles.mappingNeedsAction(saved),true);
  const confirmed={...saved,confirmedAt:"2026-10-01",confirmedGroupIds:["g"]};
  assert.equal(roles.mappingNeedsAction(confirmed),false);
  const [edited]=roles.validateRoleGroupMappings([{...confirmed,groupIds:[]}],new Set(["g"]),[confirmed]);
  assert.equal(roles.mappingNeedsAction(edited),true);
  assert.throws(()=>roles.validateRoleGroupMappings([{...input,groupIds:["unknown"]}],new Set(["g"]),[]));
  assert.throws(()=>roles.validateRoleGroupMappings([input,{...input,id:"r2"}],new Set(["g"]),[]));
});
test("auto-sync is opt-in, has validated intervals and a durable next-run boundary", () => {
  assert.equal(sync.defaultSyncSettings.enabled,false);
  assert.equal(sync.defaultSyncSettings.intervalMinutes,15);
  assert.equal(sync.syncDue(sync.defaultSyncSettings,sync.emptySyncState,Date.now()),false);
  const enabled={enabled:true,intervalMinutes:15};
  assert.equal(sync.syncDue(enabled,sync.emptySyncState,Date.now()),true);
  assert.equal(sync.syncDue(enabled,{...sync.emptySyncState,nextRunAt:new Date(Date.now()+60000).toISOString()},Date.now()),false);
  for (const bad of [null,{enabled:"true",intervalMinutes:15},{enabled:true,intervalMinutes:0},{enabled:true,intervalMinutes:1}]) assert.throws(()=>sync.validateSyncSettings(bad));
});
