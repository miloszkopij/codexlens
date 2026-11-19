import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const policyUrl = url(compile(await readFile(new URL("../lib/access-policy.ts", import.meta.url), "utf8")));
const policy = await import(policyUrl);
const groups = [
  { id: "dev", name: "Developers", source: "Manual" }, { id: "pm", name: "PM", source: "Manual" },
  { id: "ce", name: "Ceneo", source: "Manual" }, { id: "eb", name: "eBilet", source: "Manual" },
  { id: "admin", name: "admin", source: "Manual" }, { id: "cat", name: "cat-team", source: "Manual" },
  { id: "scim", name: "Identity managed", source: "SCIM" },
];
const rules = { policyVersion: 2, roleToGroups: { Engineer: ["dev"] }, entityToGroups: {}, emailDomainToGroups: { "ceneo.pl": ["ce"], "ebilet.pl": ["eb"] } };
const member = (ids = ["pm", "admin", "cat"], extra = {}) => ({ id: "u1", name: "Test Person", email: "test@CENEO.PL", peopleRole: "Engineer", peopleMatch: "Matched", entity: "Ceneo", status: "Active", groupIds: ids, groups: ids.map((id) => groups.find((g) => g.id === id)?.name ?? id), ...extra });

test("exact normalized domain overrides job title; entity labels never assign groups", () => {
  assert.equal(policy.reviewMember(member(), groups, rules).expected, "ce");
  assert.equal(policy.reviewMember(member([], { email: "test@ebilet.pl" }), groups, rules).expected, "eb");
  for (const domain of ["sub.ceneo.pl", "notceneo.pl", "ceneo.pl.evil.test", "allegro.com"]) {
    assert.equal(policy.reviewMember(member([], { email: `test@${domain}` }), groups, rules).expected, "dev");
  }
  assert.equal(policy.emailDomain(" test@CENEO.PL "), "ceneo.pl");
  assert.equal(policy.emailDomain("test@@ceneo.pl"), "");
  assert.equal(policy.emailDomain("bad email@ceneo.pl"), "");
  for (const bad of ["*.ceneo.pl", "test@ceneo.pl", "ceneo..pl", ".ceneo.pl", "-ceneo.pl"]) assert.throws(() => policy.normalizeDomain(bad));
});
test("word search matches job titles without case or accents", () => {
  assert.equal(policy.titleMatchesWords("Senior Data Platform Engineer", "data engineer"), true);
  assert.equal(policy.titleMatchesWords("Inżynier Danych", "inzynier danych"), true);
  assert.equal(policy.titleMatchesWords("Software Engineer", "data"), false);
});
test("person exception outranks automatic rules, including when People API is missing", () => {
  const override = { ...rules, memberOverrides: { u1: "pm" } };
  const person = member(["ce", "admin"], { peopleMatch: "Missing" });
  const review = policy.reviewMember(person, groups, override);
  assert.equal(review.expected, "pm");
  assert.equal(review.source, "person-exception");
  assert.equal(review.status, "different");
  assert.deepEqual(policy.planMemberChange(person, groups, override, { kind: "rules" }).after, ["admin", "pm"]);
  assert.notEqual(policy.accessRulesRevision(rules), policy.accessRulesRevision(override));
});
test("special-group person exception only adds special membership", () => {
  const override = { ...rules, memberOverrides: { u1: "cat" } };
  const person = member(["dev", "admin"], { peopleMatch: "Missing" });
  const review = policy.reviewMember(person, groups, override);
  assert.equal(review.specialTarget, true);
  assert.equal(review.status, "different");
  const change = policy.planMemberChange(person, groups, override, { kind: "rules" });
  assert.deepEqual(change.remove, []);
  assert.deepEqual(change.add, ["cat"]);
  assert.deepEqual(change.after, ["admin", "cat", "dev"]);
  assert.equal(policy.reviewMember(member(["dev", "admin", "cat"]), groups, override).status, "aligned");
});
test("person exceptions require a manual group", () => {
  assert.equal(policy.validateAccessRules({ ...rules, memberOverrides: { u1: "admin" } }, groups).memberOverrides.u1, "admin");
  for (const id of ["scim", "deleted"]) assert.throws(() => policy.validateAccessRules({ ...rules, memberOverrides: { u1: id } }, groups));
});
test("special groups do not count toward the one-regular-group policy", () => {
  assert.equal(policy.reviewMember(member(["dev", "admin", "cat"]), groups, rules).conflict, false);
  assert.equal(policy.reviewMember(member(["dev", "ce", "admin"]), groups, rules).conflict, true);
  assert.equal(policy.reviewMember(member(["ce", "eb"]), groups, rules).conflict, true);
  assert.equal(policy.reviewMember(member(["admin"]), groups, rules).regular.length, 0);
  assert.equal(policy.hasNoRegularGroup(member([]), groups), true);
  assert.equal(policy.hasNoRegularGroup(member(["admin", "cat"]), groups), true);
  assert.equal(policy.hasNoRegularGroup(member(["dev", "admin"]), groups), false);
  assert.equal(policy.hasNoRegularGroup(member(["deleted"]), groups), false);
});
test("membership status filter uses the same regular-group classification as the table", () => {
  const cases = [
    [[], "missing"], [["admin", "cat"], "missing"],
    [["dev"], "single"], [["dev", "admin", "cat"], "single"],
    [["dev", "ce"], "conflict"], [["ce", "eb", "admin"], "conflict"],
    [["scim", "dev"], "conflict"], [["dev", "dev", "admin"], "single"],
  ];
  for (const [ids, expected] of cases) {
    for (const extra of [{}, { status: "Inactive" }, { peopleMatch: "Missing" }]) {
      const review = policy.reviewMember(member(ids, extra), groups, rules);
      assert.equal(policy.memberGroupStatus(review), expected);
    }
  }
  assert.deepEqual(Object.values(policy.memberGroupStatusLabels), ["Conflict", "Needs regular group", "One regular group"]);
});
test("moves reconcile regular groups while preserving every special membership", () => {
  const plan = policy.planMemberChange(member(), groups, rules, { kind: "rules" });
  assert.deepEqual(plan.remove, ["pm"]); assert.deepEqual(plan.add, ["ce"]);
  assert.deepEqual(plan.after, ["admin", "cat", "ce"]);
  assert.deepEqual(plan.retainedSpecial, ["admin", "cat"]);
  const manual = policy.planMemberChange(member(["pm", "ce", "cat"]), groups, rules, { kind: "move", groupId: "dev" });
  assert.deepEqual(manual.remove, ["ce", "pm"]); assert.deepEqual(manual.after, ["cat", "dev"]);
  assert.equal(policy.planMemberChange(member(["ce", "cat"]), groups, rules, { kind: "rules" }), null);
});
test("special memberships can be explicitly assigned and removed for one person", () => {
  const add = policy.planMemberChange(member(["dev", "cat"]), groups, rules, { kind: "special", groupId: "admin", action: "add" });
  assert.deepEqual(add.after, ["admin", "cat", "dev"]); assert.deepEqual(add.remove, []);
  const remove = policy.planMemberChange(member(), groups, rules, { kind: "special", groupId: "cat", action: "remove" });
  assert.deepEqual(remove.after, ["admin", "pm"]);
  assert.throws(() => policy.planMemberChange(member(), groups, rules, { kind: "move", groupId: "admin" }));
  assert.throws(() => policy.planMemberChange(member(), groups, rules, { kind: "special", groupId: "ce", action: "add" }));
  assert.throws(() => policy.planMemberChange(member([], {status:"Inactive"}), groups, rules, { kind: "special", groupId: "admin", action: "add" }), /active/);
  assert.deepEqual(policy.planMemberChange(member(["admin"], {status:"Inactive"}), groups, rules, { kind: "special", groupId: "admin", action: "remove" }).after, []);
});
test("legacy rules, ambiguous memberships and externally managed removals are blocked", () => {
  assert.throws(() => policy.planMemberChange(member(), groups, { ...rules, policyVersion: undefined }, { kind: "rules" }), /migrated/);
  assert.throws(() => policy.planMemberChange(member(["scim", "admin"]), groups, rules, { kind: "rules" }), /externally managed/);
  assert.throws(() => policy.planMemberChange(member(["scim"]), groups, rules, { kind: "move", groupId: "dev" }), /Externally/);
  assert.throws(() => policy.memberGroupIds(member(["deleted"]), groups), /Unresolved/);
  assert.throws(() => policy.memberGroupIds(member([], { groupIds: undefined, groups: ["PM"] }), [...groups, { id: "pm2", name: "PM", source: "Manual" }]), /Ambiguous/);
});
test("missing People API blocks job rules but exact domain rules use workspace email independently", () => {
  const stale = member([], { email: "person@allegro.com", peopleMatch: "Stale" });
  assert.equal(policy.reviewMember(stale, groups, rules).status, "blocked");
  assert.equal(policy.reviewMember(member([], { peopleMatch: "Missing" }), groups, rules).expected, "ce");
});
test("rule validation rejects multi-target, special, unknown, duplicate normalized domain and entity rules", () => {
  assert.deepEqual(policy.validateAccessRules(rules, groups).emailDomainToGroups["ceneo.pl"], ["ce"]);
  assert.equal(Object.keys(policy.validateAccessRules({...rules, emailDomainToGroups:{"unused.example":[]}}, groups).emailDomainToGroups).length,0);
  for (const bad of [
    { ...rules, roleToGroups: { Engineer: ["dev", "pm"] } }, { ...rules, roleToGroups: { Engineer: ["admin"] } },
    { ...rules, emailDomainToGroups: { "ceneo.pl": ["ce"], "@CENEO.PL": ["dev"] } },
    { ...rules, roleToGroups: { Engineer: ["scim"] } }, { ...rules, roleToGroups: { Engineer: ["deleted"] } },
    { ...rules, entityToGroups: { Ceneo: ["ce"] } },
  ]) assert.throws(() => policy.validateAccessRules(bad, groups));
});
test("one job title can target separate groups inside and outside David Roberts's structure", () => {
  const split = { ...rules, roleToGroupsInLeaderStructure: { Engineer: ["pm"] }, roleToGroupsOutsideLeaderStructure: { Engineer: ["dev"] }, emailDomainToGroups: {} };
  const inside = { personId: "u1", ancestorIds: ["manager", "david", "ceo"], leaderId: "david", problem: null };
  const david = { personId: "david", ancestorIds: ["ceo"], leaderId: "david", problem: null };
  const outside = { personId: "u2", ancestorIds: ["other", "ceo"], leaderId: "david", problem: null };
  const engineer = member([], { email: "test@allegro.com" });
  assert.equal(policy.reviewMember(engineer, groups, split, inside).expected, "pm");
  assert.equal(policy.reviewMember(engineer, groups, split, david).expected, "pm");
  assert.equal(policy.reviewMember(engineer, groups, split, outside).expected, "dev");
  assert.match(policy.reviewMember(engineer, groups, split, outside).reason, /outside David Roberts/);
  assert.equal(policy.reviewMember(engineer, groups, split).status, "blocked");
  assert.equal(policy.reviewMember(engineer, groups, split, { ...outside, problem: "Ambiguous match" }).status, "blocked");
  assert.equal(policy.reviewMember(engineer, groups, { ...split, emailDomainToGroups: { "allegro.com": ["ce"] } }).expected, "ce");
  assert.equal(policy.reviewMember(engineer, groups, { ...split, structureRules: [{ managerId: "manager", managerName: "Manager", managerEmail: null, groupId: "ce" }] }, inside).expected, "ce");
});
test("scoped no-rule overrides legacy title mapping and survives validation", () => {
  const split = { ...rules, emailDomainToGroups: {}, roleToGroupsInLeaderStructure: { Engineer: [] }, roleToGroupsOutsideLeaderStructure: { Engineer: ["pm"] } };
  const validated = policy.validateAccessRules(split, groups);
  assert.deepEqual(validated.roleToGroupsInLeaderStructure.Engineer, []);
  assert.deepEqual(policy.scopedRoleGroups(validated, "Engineer", "inside"), []);
  assert.deepEqual(policy.scopedRoleGroups(validated, "Engineer", "outside"), ["pm"]);
  assert.equal(policy.reviewMember(member([], { email: "test@allegro.com" }), groups, validated, { personId: "u1", ancestorIds: ["david"], leaderId: "david", problem: null }).status, "unmapped");
  assert.notEqual(policy.accessRulesRevision(rules), policy.accessRulesRevision(split));
  for (const bad of [{ ...split, roleToGroupsInLeaderStructure: { Engineer: ["admin"] } }, { ...split, roleToGroupsOutsideLeaderStructure: { Engineer: ["dev", "pm"] } }]) assert.throws(() => policy.validateAccessRules(bad, groups));
});

// Route isolation: neither the fixtures nor the tests contain usable credentials or make real network calls.
const fixture = { groups, rules, member: member() };
const stubUrl = url(`
const fixture = ${JSON.stringify(fixture)};
export const state = { remote: [...fixture.member.groupIds], local: [...fixture.member.groupIds], plans: new Map(), calls: [], locked: false, failAdd: false, rules: fixture.rules, structures: {}, structureReads: [] };
export const getWorkspaceConfig = () => ({ workspaceId: 'w', workspaceName: 'Test', adminKey: 'test-only', openAiBaseUrl: 'https://invalid.example' });
export const getDashboard = async () => ({ members: [{...fixture.member, groupIds:[...state.local]}], groups: fixture.groups });
export const getOrganizerMappings = async () => state.rules;
export const getOrganizerStructureContext = async (_base, _members, _rules, fresh) => {state.structureReads.push(fresh);return {members:state.structures};};
export const setStoredMembership = async (_u,g,action) => { state.calls.push('stored:'+action+':'+g); state.local = action==='add' ? [...state.local,g] : state.local.filter(id=>id!==g); };
export const acquireWorkspaceLock = async () => !state.locked;
export const releaseWorkspaceLock = async () => {};
export const renewWorkspaceLock = async () => {};
export const saveAccessPlan = async (id,w,payload) => {state.plans.set(id,payload);};
export const claimAccessPlan = async id => {const p=state.plans.get(id); if(!p) throw new Error('already attempted'); state.plans.delete(id); return p;};
export const listWorkspaceGroups = async () => fixture.groups;
export const getWorkspaceUser = async () => fixture.member;
export const listGroupUsers = async (_b,_w,g) => state.remote.includes(g) ? [fixture.member] : [];
export const updateGroupMembership = async (_b,_w,g,_u,_k,action) => {state.calls.push(action+':'+g); if(state.failAdd && action==='add') throw new Error('uncertain write'); state.remote=action==='add' ? [...state.remote,g] : state.remote.filter(id=>id!==g);};
export const getChatGPTUser = async () => null;
`);
const safetyUrl = url(compile(await readFile(new URL("../lib/request-safety.ts", import.meta.url), "utf8")));
let route = await readFile(new URL("../app/api/access-plan/route.ts", import.meta.url), "utf8");
route = route.replace(/from "(?:\.\.\/){2,3}(?:db\/store|db\/access-store|lib\/config|lib\/openai-admin|lib\/organizer-context|chatgpt-auth)"/g, `from "${stubUrl}"`)
  .replace('from "../../../lib/access-policy"', `from "${policyUrl}"`).replace('from "../../../lib/request-safety"', `from "${safetyUrl}"`);
const { POST } = await import(url(compile(route))); const { state } = await import(stubUrl);
const reset = () => Object.assign(state, { remote: [...fixture.member.groupIds], local: [...fixture.member.groupIds], plans: new Map(), calls: [], locked: false, failAdd: false, rules: fixture.rules, structures: {}, structureReads: [] });
const request = (body, headers = {}) => new Request("http://localhost/api/access-plan", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
async function preview(operation = { kind: "rules" }) { const result = await POST(request({ intent: "preview", memberIds: ["u1"], operation })); assert.equal(result.status,200); return result.json(); }
test("preview never writes; applying a reviewed plan reconciles and cannot be replayed", async () => {
  reset(); const plan = await preview(); assert.deepEqual(state.calls, []);
  const response = await POST(request({ intent: "apply", planId: plan.id, acknowledged: true }));
  assert.equal(response.status,200); assert.equal((await response.json()).verified,1);
  assert.deepEqual([...state.remote].sort(), ["admin","cat","ce"]);
  assert.deepEqual(state.calls, ["remove:pm","stored:remove:pm","add:ce","stored:add:ce"]);
  assert.equal((await POST(request({ intent: "apply", planId: plan.id, acknowledged: true }))).status,409);
});
test("remote stale membership, local stale state, lock and cross-origin requests block writes", async () => {
  reset(); let plan = await preview(); state.remote.push("dev");
  assert.equal((await POST(request({ intent:"apply",planId:plan.id,acknowledged:true }))).status,409); assert.deepEqual(state.calls,[]);
  reset(); plan = await preview(); state.local.push("dev");
  assert.equal((await POST(request({ intent:"apply",planId:plan.id,acknowledged:true }))).status,409); assert.deepEqual(state.calls,[]);
  reset(); plan = await preview(); state.locked=true;
  assert.equal((await POST(request({ intent:"apply",planId:plan.id,acknowledged:true }))).status,409); assert.deepEqual(state.calls,[]);
  assert.equal((await POST(request({ intent:"preview",memberIds:["u1"],operation:{kind:"rules"} }, {Origin:"https://evil.example"}))).status,409);
});
test("uncertain writes stop the plan, preserve special groups and expose partial results", async () => {
  reset(); const plan = await preview(); state.failAdd=true;
  const response=await POST(request({intent:"apply",planId:plan.id,acknowledged:true}));
  const result=await response.json(); assert.equal(result.verified,0); assert.equal(result.results[0].status,"uncertain");
  assert.deepEqual(state.remote.sort(),["admin","cat"]); assert.equal(state.calls.filter(c=>c==="add:ce").length,1);
});
test("explicit per-member special assignment uses the same reviewed route", async () => {
  reset(); const plan=await preview({kind:"special",groupId:"cat",action:"remove"});
  assert.equal((await POST(request({intent:"apply",planId:plan.id,acknowledged:true}))).status,200);
  assert.deepEqual(state.remote.sort(),["admin","pm"]);
});
test("person exception can add a special group without People API and retain regular membership", async () => {
  reset(); state.rules = { ...rules, memberOverrides: { u1: "admin" } };
  state.local = ["pm", "cat"]; state.remote = ["pm", "cat"];
  const plan = await preview();
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0].add, ["admin"]);
  assert.deepEqual(plan.changes[0].remove, []);
  assert.deepEqual(state.structureReads, []);
  const response = await POST(request({ intent: "apply", planId: plan.id, acknowledged: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.remote.sort(), ["admin", "cat", "pm"]);
  assert.deepEqual(state.structureReads, []);
});

function structureFixture() {
  reset();
  state.rules = {...rules,emailDomainToGroups:{},structureRules:[{managerId:"manager",managerName:"Test Manager",managerEmail:"manager@example.com",groupId:"ce"}]};
  state.structures = {u1:{ancestorIds:["manager"],problem:null}};
}
test("structure plans recheck fresh hierarchy at apply and retain special memberships",async()=>{
  structureFixture();const plan=await preview();
  assert.match(plan.changes[0].reason,/Test Manager/);
  const result=await POST(request({intent:"apply",planId:plan.id,acknowledged:true}));
  assert.equal((await result.json()).verified,1);
  assert.deepEqual([...state.remote].sort(),["admin","cat","ce"]);
  assert.deepEqual(state.structureReads,[true,true]);
});
test("changed or unavailable reporting hierarchy rejects the preview before any OpenAI write",async()=>{
  for(const context of [{ancestorIds:["other-manager"],problem:null},{ancestorIds:[],problem:"People unavailable"}]){
    structureFixture();const plan=await preview();state.structures={u1:context};
    const result=await POST(request({intent:"apply",planId:plan.id,acknowledged:true}));
    assert.equal(result.status,409);assert.deepEqual(state.calls,[]);
  }
  structureFixture();state.structures={};
  const plan=await preview();assert.equal(plan.changes.length,0);assert.equal(plan.blocked.length,1);
});
test("manual special-group changes remain independent of reporting API availability",async()=>{
  structureFixture();state.structures={};
  const plan=await preview({kind:"special",groupId:"cat",action:"remove"});
  assert.equal((await POST(request({intent:"apply",planId:plan.id,acknowledged:true}))).status,200);
  assert.deepEqual(state.structureReads,[]);
});
test("scoped title plans use verified David membership and recheck it before any write",async()=>{
  reset();
  state.rules={...rules,emailDomainToGroups:{},roleToGroupsInLeaderStructure:{Engineer:["ce"]},roleToGroupsOutsideLeaderStructure:{Engineer:["dev"]}};
  state.structures={u1:{personId:"person-1",ancestorIds:["david"],leaderId:"david",problem:null}};
  const plan=await preview();
  assert.equal(plan.changes.length,1);
  assert.match(plan.changes[0].reason,/inside David Roberts/);
  state.structures={u1:{personId:"person-1",ancestorIds:["other"],leaderId:"david",problem:null}};
  const response=await POST(request({intent:"apply",planId:plan.id,acknowledged:true}));
  assert.equal(response.status,409);
  assert.deepEqual(state.calls,[]);
});
