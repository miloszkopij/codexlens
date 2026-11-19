import type { Entity, OrganizerMappings, StructureGroupRule } from "../app/types";

/** Read a local backup without trusting extra fields or a saved revision in the file. */
export function parseOrganizerDraft(payload: unknown): OrganizerMappings {
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const raw = envelope && Object.hasOwn(envelope, "draft") ? envelope.draft : payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("This file does not contain an Organize draft.");
  const value = raw as Record<string, unknown>;
  function mapping(input: unknown, optional = false): Record<string, string[]> {
    if (optional && input === undefined) return {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The draft has invalid mapping rows.");
    const entries = Object.entries(input);
    if (entries.length > 1000 || entries.some(([key, ids]) => !key.trim() || key.length > 253 || ["__proto__", "constructor", "prototype"].includes(key) || !Array.isArray(ids) || ids.length > 10 || ids.some((id) => typeof id !== "string" || id.length > 200))) throw new Error("The draft has invalid mapping rows.");
    return Object.fromEntries(entries.map(([key, ids]) => [key, [...ids as string[]]]));
  }
  const structureRules = value.structureRules ?? [];
  if (!Array.isArray(structureRules) || structureRules.length > 100 || structureRules.some((rule) => !rule || typeof rule !== "object" || typeof rule.managerId !== "string" || typeof rule.managerName !== "string" || typeof rule.groupId !== "string" || !(rule.managerEmail === null || typeof rule.managerEmail === "string"))) throw new Error("The draft has invalid manager rules.");
  if (value.policyVersion !== undefined && value.policyVersion !== 2) throw new Error("This draft uses an unsupported policy version.");
  const rawOverrides = value.memberOverrides ?? {};
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides) || Object.keys(rawOverrides).length > 1000 || Object.entries(rawOverrides).some(([memberId, groupId]) => !memberId.trim() || memberId.length > 200 || ["__proto__", "constructor", "prototype"].includes(memberId) || typeof groupId !== "string" || groupId.length > 200)) throw new Error("The draft has invalid person exceptions.");
  return {
    ...(value.policyVersion === 2 ? { policyVersion: 2 as const } : {}),
    roleToGroups: mapping(value.roleToGroups),
    roleToGroupsInLeaderStructure: mapping(value.roleToGroupsInLeaderStructure, true),
    roleToGroupsOutsideLeaderStructure: mapping(value.roleToGroupsOutsideLeaderStructure, true),
    entityToGroups: mapping(value.entityToGroups, true) as Partial<Record<Entity, string[]>>,
    emailDomainToGroups: mapping(value.emailDomainToGroups),
    structureRules: structureRules.map((rule) => ({ managerId: rule.managerId, managerName: rule.managerName, managerEmail: rule.managerEmail, groupId: rule.groupId }) as StructureGroupRule),
    memberOverrides: Object.fromEntries(Object.entries(rawOverrides)),
  };
}
