import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = await import(moduleUrl(compile(await readFile(new URL("../lib/access-review.ts", import.meta.url), "utf8"))));
const { currentGroupIds, reviewAccess, matchesAccessFilter, buildMembershipPlan, validateExclusiveSets } = helpers;
const groups = [
  { id: "dev", name: "Developers", source: "Manual" },
  { id: "pm", name: "PM", source: "Manual" },
  { id: "eb", name: "eBilet", source: "Manual" },
  { id: "ce", name: "Ceneo", source: "Manual" },
  { id: "sso", name: "SSO", source: "SCIM" },
];
const mappings = { roleToGroups: { "Software Engineer": ["dev", "sso"] }, entityToGroups: { eBilet: ["eb"] }, emailDomainToGroups: { "ebilet.example": ["eb"] } };
const empty = { roleToGroups: {}, entityToGroups: {}, emailDomainToGroups: {} };
const member = (ids = [], extra = {}) => ({ id: "person-1", name: "Demo Person", email: "person@EBILET.EXAMPLE", peopleRole: "Software Engineer", entity: "eBilet", peopleMatch: "Matched", groupIds: ids, groups: ids.map((id) => groups.find((group) => group.id === id)?.name ?? id), ...extra });

test("unions job title, entity and email domain mappings without duplicate memberships", () => {
  const review = reviewAccess(member(["dev", "sso"]), groups, mappings, []);
  assert.deepEqual([...review.expected.keys()], ["dev", "eb"]);
  assert.deepEqual(review.missing, ["eb"]);
  assert.equal(review.expected.get("eb").length, 2);
  assert.deepEqual(review.extra, []); // SCIM is not an extra manual assignment.
});

test("overlap is informational unless an explicit mutually exclusive set matches", () => {
  const sets = [{ id: "entities", name: "Entities", groupIds: ["eb", "ce"] }];
  assert.equal(reviewAccess(member(["dev", "eb"]), groups, mappings, sets).conflicts.length, 0);
  assert.equal(reviewAccess(member(["dev", "eb", "ce"]), groups, mappings, sets).conflicts.length, 1);
  assert.equal(reviewAccess(member(["dev", "pm"]), groups, mappings, []).conflicts.length, 0);
});

test("missing profiles and no mappings do not label every membership as extra", () => {
  for (const peopleMatch of ["Missing", "Ambiguous"]) {
    const review = reviewAccess(member(["pm"], { peopleMatch }), groups, mappings, []);
    assert.equal(review.unresolved, true);
    assert.equal(review.comparable, false);
    assert.deepEqual(review.missing, []);
    assert.deepEqual(review.extra, []);
  }
  assert.equal(reviewAccess(member(["pm"]), groups, empty, []).unmapped, true);
  assert.deepEqual(reviewAccess(member(["pm"]), groups, empty, []).extra, []);
});

test("supports count, any/all groups and mapping status filters together", () => {
  const review = reviewAccess(member(["dev", "pm"]), groups, mappings, []);
  const filter = { count: "multiple", groupIds: ["dev", "eb"], match: "any", status: "missing" };
  assert.equal(matchesAccessFilter(review, filter), true);
  assert.equal(matchesAccessFilter(review, { ...filter, match: "all" }), false);
  assert.equal(matchesAccessFilter(review, { ...filter, count: "one" }), false);
  assert.equal(matchesAccessFilter(review, { ...filter, status: "extra" }), true);
  const correct = reviewAccess(member(["dev", "eb"]), groups, mappings, []);
  assert.equal(matchesAccessFilter(correct, { ...filter, groupIds: [], status: "matches" }), true);
  const none = reviewAccess(member(), groups, empty, []);
  assert.equal(matchesAccessFilter(none, { count: "none", groupIds: [], match: "all", status: "unmapped" }), true);
});

test("plans only actual changes, preserves unrelated groups and never mutates the source", () => {
  const people = [member(["dev", "sso"]), member(["dev", "eb"], { id: "person-2" })];
  const original = JSON.stringify(people);
  const additions = buildMembershipPlan(people, groups, "eb", "add");
  assert.equal(additions.length, 1);
  assert.deepEqual(additions[0].before, ["dev", "sso"]);
  assert.deepEqual(additions[0].after, ["dev", "eb", "sso"]);
  const removals = buildMembershipPlan(people, groups, "eb", "remove");
  assert.equal(removals.length, 1);
  assert.equal(removals[0].memberId, "person-2");
  assert.deepEqual(removals[0].after, ["dev"]);
  assert.equal(JSON.stringify(people), original);
  assert.throws(() => buildMembershipPlan(people, groups, "sso", "remove"), /SCIM/);
  assert.throws(() => buildMembershipPlan(people, groups, "deleted", "add"), /manual group/);
});

test("IDs distinguish identical names; unresolved legacy memberships block edits", () => {
  const duplicates = [...groups, { id: "dev-copy", name: "Developers", source: "Manual" }];
  assert.deepEqual(currentGroupIds(member(["dev"]), duplicates), ["dev"]);
  const legacy = member([], { groupIds: undefined, groups: ["Developers"] });
  assert.equal(reviewAccess(legacy, duplicates, mappings, []).resolved, false);
  assert.throws(() => buildMembershipPlan([legacy], duplicates, "eb", "add"), /could not be resolved/);
  assert.deepEqual(currentGroupIds(legacy, groups), ["dev"]);
});

test("validates exclusive sets, including unknown groups, duplicate IDs and empty sets", () => {
  const ids = new Set(groups.map((group) => group.id));
  const set = { id: "entities", name: " Entities ", groupIds: ["eb", "ce", "eb"] };
  assert.deepEqual(validateExclusiveSets([set], ids), [{ id: "entities", name: "Entities", groupIds: ["eb", "ce"] }]);
  for (const invalid of [null, {}, [set, set], [{ ...set, name: " " }], [{ ...set, groupIds: ["eb"] }], [{ ...set, groupIds: ["eb", "deleted"] }]]) {
    assert.throws(() => validateExclusiveSets(invalid, ids));
  }
  assert.deepEqual(validateExclusiveSets([], ids), []);
});

// Legacy endpoint is retired; v2 route behavior is exercised in access-policy.test.mjs.
test("legacy direct membership writes cannot bypass reviewed plans", async () => {
  const source = await readFile(new URL("../app/api/group-membership/route.ts", import.meta.url), "utf8");
  const { POST } = await import(moduleUrl(compile(source)));
  assert.equal((await POST()).status, 410);
});
