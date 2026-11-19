import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const hierarchyUrl = url(compile(await source("../lib/structure-rules.ts")));
const { resolveStructureContext, n1HeadIdForContext } = await import(hierarchyUrl);
const policyUrl = url(compile(await source("../lib/access-policy.ts")));
const policy = await import(policyUrl);
const profile = (id, managerId, extra = {}) => ({id,displayName:`Person ${id}`,email:`${id}@example.com`,isActive:true,...(managerId ? {manager:{id:managerId,displayName:"Same name"}}:{}),...extra});
const people = [profile("ceo"), profile("director","ceo",{displayName:"David Roberts"}),profile("team","director"),profile("engineer","team"),profile("outside","ceo")];
const member = (id="engineer",extra={}) => ({id,email:`${id}@example.com`,name:id,peopleMatch:"Matched",peopleRole:"Engineer",status:"Active",groups:["PM","admin","cat-team"],groupIds:["pm","admin","cat"],...extra});
const groups = [{id:"dev",name:"Developers",source:"Manual"},{id:"pm",name:"PM",source:"Manual"},{id:"ce",name:"Ceneo",source:"Manual"},{id:"admin",name:"admin",source:"Manual"},{id:"cat",name:"cat-team",source:"Manual"},{id:"scim",name:"Managed",source:"SCIM"}];
const structure = (managerId,groupId) => ({managerId,managerName:`Leader ${managerId}`,managerEmail:`${managerId}@example.com`,groupId});
const rules = {...policy.emptyAccessRules,roleToGroups:{Engineer:["dev"]},structureRules:[structure("director","pm"),structure("team","ce")]};

test("uses all reporting levels by ID, without requiring managers to have workspace seats",()=>{
  const contexts=resolveStructureContext(people,[member()],rules.structureRules);
  assert.deepEqual(contexts.engineer.ancestorIds,["team","director","ceo"]);
  assert.equal(contexts.engineer.personId,"engineer");
  assert.equal(contexts.engineer.problem,null);
  const review=policy.reviewMember(member(),groups,rules,contexts.engineer);
  assert.equal(review.expected,"ce");assert.equal(review.source,"structure");
  assert.match(review.reason,/Leader team/);
  const moved=policy.planMemberChange(member(),groups,rules,{kind:"rules"},contexts.engineer);
  assert.deepEqual(moved.after,["admin","cat","ce"]);
  assert.deepEqual(moved.remove,["pm"]);
});
test("N-1 ownership includes the head and all descendants, but not the root or unresolved people",()=>{
  const contexts=resolveStructureContext(people,[member("director"),member("team"),member("engineer"),member("outside"),member("ceo"),member("unknown")],[],"director");
  assert.equal(n1HeadIdForContext(contexts.director,"ceo"),"director");
  assert.equal(n1HeadIdForContext(contexts.team,"ceo"),"director");
  assert.equal(n1HeadIdForContext(contexts.engineer,"ceo"),"director");
  assert.equal(n1HeadIdForContext(contexts.outside,"ceo"),"outside");
  assert.equal(n1HeadIdForContext(contexts.ceo,"ceo"),null);
  assert.equal(n1HeadIdForContext(contexts.unknown,"ceo"),null);
});
test("domain beats structure; nearest configured ancestor beats higher manager and job title",()=>{
  const context=resolveStructureContext(people,[member()],rules.structureRules).engineer;
  assert.equal(policy.reviewMember(member(),groups,{...rules,emailDomainToGroups:{"example.com":["dev"]}},context).expected,"dev");
  assert.equal(policy.reviewMember(member(),groups,{...rules,structureRules:[...rules.structureRules].reverse()},context).expected,"ce");
  assert.equal(policy.reviewMember(member(),groups,{...rules,structureRules:[structure("director","pm")]},context).expected,"pm");
});
test("includes the manager, direct and indirect reports; outsiders fall back after verification",()=>{
  const onlyDirector={...rules,structureRules:[structure("director","pm")]};
  for(const id of ["director","team","engineer","outside"]){
    const person=member(id); const context=resolveStructureContext(people,[person],onlyDirector.structureRules)[id];
    assert.equal(policy.reviewMember(person,groups,onlyDirector,context).expected,id==="outside"?"dev":"pm");
    assert.equal(policy.reviewMember(person,groups,onlyDirector).status,"blocked");
  }
});
test("manager's own rule wins over parent structures but not domain, using People API identity",()=>{
  // OpenAI and People API IDs are unrelated: match the manager by verified email.
  const person=member("workspace-user-42",{email:"team@example.com"});
  const context=resolveStructureContext(people,[person],rules.structureRules)[person.id];
  assert.equal(context.personId,"team");
  for(const structureRules of [rules.structureRules,[...rules.structureRules].reverse()]){
    const review=policy.reviewMember(person,groups,{...rules,structureRules},context);
    assert.equal(review.expected,"ce");assert.match(review.reason,/selected manager included/);
  }
  assert.equal(policy.reviewMember(person,groups,{...rules,emailDomainToGroups:{"example.com":["dev"]}},context).expected,"dev");
  assert.deepEqual(policy.planMemberChange(person,groups,rules,{kind:"rules"},context).after,["admin","cat","ce"]);
  const ceoRules={...rules,structureRules:[structure("ceo","ce")]};
  const ceo=member("ceo");const ceoContext=resolveStructureContext(people,[ceo],ceoRules.structureRules).ceo;
  assert.equal(policy.reviewMember(ceo,groups,ceoRules,ceoContext).expected,"ce");
});
test("inactive or ambiguous managers are not included via their own rules",()=>{
  const manager=member("team");
  for(const directory of [people.map(p=>p.id==="team"?{...p,isActive:false}:p),[...people,profile("duplicate",null,{email:"team@example.com"})]]){
    const context=resolveStructureContext(directory,[manager],rules.structureRules).team;
    assert.equal(context.personId,null);assert.equal(policy.reviewMember(manager,groups,rules,context).status,"blocked");
  }
});
test("ambiguous email, duplicate workspace accounts, inactive or unverified profiles block structures",()=>{
  const variations=[
    [...people,profile("duplicate", "ceo",{email:"engineer@example.com"})],
    people.map(p=>p.id==="engineer"?{...p,isActive:false}:p),
    people.map(p=>p.id==="engineer"?{...p,isActive:undefined}:p),
  ];
  for(const directory of variations){
    const context=resolveStructureContext(directory,[member()],rules.structureRules).engineer;
    assert.ok(context.problem);assert.equal(policy.reviewMember(member(),groups,rules,context).status,"blocked");
  }
  const duplicate=resolveStructureContext(people,[member(),member("duplicate",{email:"engineer@example.com"})],rules.structureRules);
  assert.ok(duplicate.engineer.problem);assert.ok(duplicate.duplicate.problem);
  const unmatched=resolveStructureContext(people,[member("unknown")],rules.structureRules);
  assert.ok(unmatched.unknown.problem);
});
test("broken paths and cycles never silently fall back; inactive intermediary managers are traversed",()=>{
  for(const manager of [{id:"missing"},{id:"engineer"},{displayName:"No stable ID"}]){
    const directory=people.map(p=>p.id==="director"?{...p,manager}:p);
    const context=resolveStructureContext(directory,[member()],rules.structureRules).engineer;
    assert.ok(context.problem);assert.deepEqual(context.ancestorIds,[]);
    assert.equal(policy.reviewMember(member(),groups,rules,context).expected,null);
  }
  const context=resolveStructureContext(people.map(p=>p.id==="team"?{...p,isActive:false}:p),[member()],rules.structureRules).engineer;
  assert.deepEqual(context.ancestorIds,["team","director","ceo"]);
  assert.equal(policy.reviewMember(member(),groups,rules,context).expected,"ce");
});
test("incomplete directories and unavailable configured managers are rejected",()=>{
  for(const directory of [[...people,profile("engineer")],[...people,{email:"missing-id@example.com"}],people.filter(p=>p.id!=="team")]) assert.throws(()=>resolveStructureContext(directory,[member()],rules.structureRules));
});
test("validates one regular target per stable manager and preserves old version-2 rules",()=>{
  assert.equal(policy.validateAccessRules(rules,groups).structureRules.length,2);
  assert.deepEqual(policy.validateAccessRules({...rules,structureRules:undefined},groups).structureRules,[]);
  for(const bad of [null,"bad",[structure("director","admin")],[structure("director","scim")],[structure("director","missing")],[structure("director","dev"),structure("director","pm")],[{...structure("director","dev"),managerId:""}],[{...structure("director","dev"),managerName:42}]]) assert.throws(()=>policy.validateAccessRules({...rules,structureRules:bad},groups));
});

const httpStubUrl=url(`export const state={calls:0,fail:false,people:${JSON.stringify(people)}};export async function fetchJson(){state.calls++;if(state.fail)throw new Error('Synthetic outage');return state.people;}`);
const peopleUrl=url(compile((await source("../lib/people-api.ts")).replace('from "./http"',`from "${httpStubUrl}"`)));
const providerUrl=url(compile((await source("../lib/organizer-context.ts")).replace('from "./people-api"',`from "${peopleUrl}"`).replace('from "./structure-rules"',`from "${hierarchyUrl}"`)));
const {getOrganizerStructureContext}=await import(providerUrl);
const {getDirectorySnapshot}=await import(peopleUrl);
const {state}=await import(httpStubUrl);
test("hierarchy provider classifies David's structure even without explicit manager rules and refreshes before writes",async()=>{
  const initial=await getOrganizerStructureContext("https://invalid.example",[member()],policy.emptyAccessRules);
  assert.equal(initial.members.engineer.leaderId,"director");
  assert.equal(initial.members.engineer.n1HeadId,"director");
  assert.deepEqual(initial.n1Heads.map((head)=>head.id),["director","outside"]);
  assert.equal(initial.n1Error,null);
  assert.equal(policy.leaderScope(initial.members.engineer),"inside");
  assert.equal(state.calls,1);
  const first=await getDirectorySnapshot("https://invalid.example");assert.equal(state.calls,1);assert.ok(first.retrievedAt);
  await getDirectorySnapshot("https://invalid.example");assert.equal(state.calls,1);
  await getOrganizerStructureContext("https://invalid.example",[member()],rules,true);assert.equal(state.calls,2);
  state.fail=true;
  const unavailable=await getOrganizerStructureContext("https://invalid.example",[member()],rules,true);
  assert.ok(unavailable.error);assert.ok(unavailable.members.engineer.problem);
  assert.equal(policy.reviewMember(member(),groups,rules,unavailable.members.engineer).status,"blocked");
  assert.equal(policy.reviewMember(member(),groups,{...rules,emailDomainToGroups:{"example.com":["ce"]}},unavailable.members.engineer).expected,"ce");
});
test("missing or ambiguous David anchor blocks scoped rules without guessing from names",async()=>{
  state.fail=false;
  const scoped={...policy.emptyAccessRules,roleToGroupsInLeaderStructure:{Engineer:["pm"]}};
  const unavailable=await getOrganizerStructureContext("https://invalid.example",[member()],scoped,true,"Unknown Leader");
  assert.ok(unavailable.error);
  assert.equal(policy.reviewMember(member(),groups,scoped,unavailable.members.engineer).status,"blocked");
  const duplicate=await getOrganizerStructureContext("https://invalid.example",[member()],scoped,true,"Person engineer");
  assert.equal(policy.leaderScope(duplicate.members.engineer),"inside");
});

const routeStubUrl=url(`
import {validateAccessRules} from '${policyUrl}';
export const state={rules:${JSON.stringify(rules)},locked:false,saves:0};
export const getOrganizerMappings=async()=>state.rules;
export const saveOrganizerMappings=async rules=>{state.rules=validateAccessRules(rules,${JSON.stringify(groups)});state.saves++;return state.rules;};
export const getWorkspaceConfig=()=>({workspaceId:'synthetic'});
export const acquireWorkspaceLock=async()=>!state.locked;
export const releaseWorkspaceLock=async()=>{};
`);
const safetyUrl=url(compile(await source("../lib/request-safety.ts")));
const routeUrl=url(compile((await source("../app/api/organizer-mappings/route.ts"))
  .replace(/from "\.\.\/\.\.\/\.\.\/(?:db\/store|db\/access-store|lib\/config)"/g,`from "${routeStubUrl}"`)
  .replace('from "../../../lib/access-policy"',`from "${policyUrl}"`)
  .replace('from "../../../lib/request-safety"',`from "${safetyUrl}"`)));
const {PATCH}=await import(routeUrl);const {state:routeState}=await import(routeStubUrl);
const patch=(body)=>PATCH(new Request("http://localhost/api/organizer-mappings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
test("saving via old clients preserves structure rules; explicit empty array removes them",async()=>{
  const legacy={...rules};delete legacy.structureRules;
  assert.equal((await patch(legacy)).status,200);assert.equal(routeState.rules.structureRules.length,2);
  assert.equal((await patch({...rules,structureRules:null})).status,400);assert.equal(routeState.rules.structureRules.length,2);
  routeState.locked=true;assert.equal((await patch({...rules,structureRules:[]})).status,409);
  routeState.locked=false;assert.equal((await patch({...rules,structureRules:[]})).status,200);assert.deepEqual(routeState.rules.structureRules,[]);
});
test("old clients preserve scoped title rules and explicit no-rule rows",async()=>{
  routeState.rules={...rules,roleToGroupsInLeaderStructure:{Engineer:[]},roleToGroupsOutsideLeaderStructure:{Engineer:["pm"]}};
  const legacy={...rules};delete legacy.roleToGroupsInLeaderStructure;delete legacy.roleToGroupsOutsideLeaderStructure;
  assert.equal((await patch(legacy)).status,200);
  assert.deepEqual(routeState.rules.roleToGroupsInLeaderStructure.Engineer,[]);
  assert.deepEqual(routeState.rules.roleToGroupsOutsideLeaderStructure.Engineer,["pm"]);
  assert.equal((await patch({...legacy,roleToGroupsInLeaderStructure:{Engineer:["dev"]},roleToGroupsOutsideLeaderStructure:{Engineer:[]}})).status,200);
  assert.deepEqual(routeState.rules.roleToGroupsOutsideLeaderStructure.Engineer,[]);
});
test("person exceptions round-trip and older clients cannot erase them",async()=>{
  routeState.rules={...rules,memberOverrides:{engineer:"admin"}};
  const older={...rules};delete older.memberOverrides;
  assert.equal((await patch(older)).status,200);
  assert.equal(routeState.rules.memberOverrides.engineer,"admin");
  assert.equal((await patch({...older,memberOverrides:{engineer:"ce"}})).status,200);
  assert.equal(routeState.rules.memberOverrides.engineer,"ce");
  assert.equal((await patch({...older,memberOverrides:{}})).status,200);
  assert.deepEqual({...routeState.rules.memberOverrides},{});
});
test("a draft cannot overwrite rules saved by another session",async()=>{
  routeState.rules=rules;
  const original=policy.accessRulesRevision(rules);
  routeState.rules={...rules,emailDomainToGroups:{"example.com":["dev"]}};
  const savesBefore=routeState.saves;
  const response=await patch({...rules,expectedRevision:original});
  assert.equal(response.status,409);assert.match((await response.json()).error,/another session/);
  assert.equal(routeState.saves,savesBefore);
  assert.equal((await patch({...rules,expectedRevision:policy.accessRulesRevision(routeState.rules)})).status,200);
});
test("draft revision ignores map and structure order but detects changed identities or targets",()=>{
  const original={...rules,roleToGroups:{Engineer:["dev"],Designer:["pm"]}};
  assert.equal(policy.accessRulesRevision(original),policy.accessRulesRevision({...original,roleToGroups:{Designer:["pm"],Engineer:["dev"]},structureRules:[...rules.structureRules].reverse()}));
  assert.notEqual(policy.accessRulesRevision(original),policy.accessRulesRevision({...original,structureRules:[structure("director","ce")]}));
  assert.notEqual(policy.accessRulesRevision(original),policy.accessRulesRevision({...original,memberOverrides:{engineer:"ce"}}));
});
