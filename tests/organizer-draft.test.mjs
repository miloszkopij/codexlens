import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/organizer-draft.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseOrganizerDraft } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const draft = { policyVersion: 2, roleToGroups: { Engineer: ["developers"] }, roleToGroupsInLeaderStructure: { Engineer: [] }, roleToGroupsOutsideLeaderStructure: { Engineer: ["pm"] }, entityToGroups: {}, emailDomainToGroups: { "ceneo.pl": ["ceneo"] }, structureRules: [{ managerId: "123", managerName: "Test Manager", managerEmail: "manager@example.com", groupId: "developers" }], memberOverrides: { user123: "developers" } };

test("restores a downloaded Organize draft without overwriting its scoped or manager rules", () => {
  const restored = parseOrganizerDraft({ draft, saved: { roleToGroups: {} }, exportedAt: "2026-10-23T00:00:00Z" });
  assert.deepEqual(restored, draft);
  assert.deepEqual(parseOrganizerDraft(draft), draft);
});
test("rejects malformed or oversized draft content and ignores unrelated fields", () => {
  for (const payload of [null, {}, { draft: [] }, { ...draft, roleToGroups: { Engineer: "developers" } }, { ...draft, structureRules: [{ managerId: 1 }] }, { ...draft, policyVersion: 1 }, { ...draft, emailDomainToGroups: { __proto__: ["x"], constructor: ["x"] } }]) {
    assert.throws(() => parseOrganizerDraft(payload));
  }
  assert.equal("adminKey" in parseOrganizerDraft({ ...draft, adminKey: "not-a-key" }), false);
});
