import type { ChangeEvent } from "../app/types";

// Exact saved actions classify existing history without guessing from names,
// free-text details or actor_source (which describes who, not what, changed).
export const changeTypes = [
  { value: "member-joined", label: "Member added", area: "workspace", actions: ["Member joined"] },
  { value: "member-removed", label: "Member removed", area: "workspace", actions: ["Member removed"] },
  { value: "group-joined", label: "Added to group", area: "workspace", actions: ["Joined a group"] },
  { value: "group-left", label: "Removed from group", area: "workspace", actions: ["Left a group"] },
  { value: "group-updated", label: "Group membership updated", area: "workspace", actions: ["Membership updated"] },
  { value: "workspace-role", label: "OpenAI workspace role", area: "workspace", actions: ["Workspace role changed"] },
  { value: "status", label: "Workspace status", area: "workspace", actions: ["Status changed"] },
  { value: "people-role", label: "People API job title", area: "people", actions: ["People API role changed"] },
  { value: "department", label: "Department", area: "people", actions: ["Department changed"] },
  { value: "manager", label: "Manager", area: "people", actions: ["Manager changed"] },
  { value: "entity", label: "Entity", area: "people", actions: ["Entity changed"] },
  { value: "profile", label: "People API profile", area: "people", actions: ["People profile missing", "People API profile changed"] },
  { value: "other", label: "Other / unclassified", area: "other", actions: [] },
] as const;
export type ChangeType = "all" | typeof changeTypes[number]["value"];
export type ChangeArea = "all" | "people" | "workspace" | "other";
export interface ChangeFilters { type: ChangeType; area: ChangeArea }
export interface ChangeActionCount { action: string; total: number; unread: number }
export interface ChangeCounts {
  total: number; unread: number; allTotal: number; allUnread: number;
  byArea: Record<ChangeArea, number>; byType: Record<ChangeType, number>;
}
export interface ChangesPage extends ChangeCounts { changes: ChangeEvent[]; offset: number; limit: number }
const knownActions: string[] = changeTypes.flatMap((type) => [...type.actions]);

export function classifyChange(action: string) {
  return changeTypes.find((type) => (type.actions as readonly string[]).includes(action)) ?? changeTypes[changeTypes.length - 1];
}
export function matchesChange(action: string, filters: ChangeFilters) {
  const type = classifyChange(action);
  return (filters.type === "all" || type.value === filters.type) && (filters.area === "all" || type.area === filters.area);
}
export function changeCounts(actions: ChangeActionCount[], filters: ChangeFilters): ChangeCounts {
  const result: ChangeCounts = { total: 0, unread: 0, allTotal: 0, allUnread: 0,
    byArea: { all: 0, people: 0, workspace: 0, other: 0 },
    byType: Object.fromEntries(["all", ...changeTypes.map((type) => type.value)].map((key) => [key, 0])) as Record<ChangeType, number> };
  for (const action of actions) {
    const type = classifyChange(action.action);
    result.allTotal += action.total; result.allUnread += action.unread;
    result.byArea.all += action.total; result.byArea[type.area] += action.total;
    if (filters.area === "all" || type.area === filters.area) { result.byType.all += action.total; result.byType[type.value] += action.total; }
    if (matchesChange(action.action, filters)) { result.total += action.total; result.unread += action.unread; }
  }
  return result;
}
export function parseChangeQuery(params: URLSearchParams) {
  const type = params.get("type") ?? "all"; const area = params.get("area") ?? "all";
  if (type !== "all" && !changeTypes.some((item) => item.value === type)) throw new Error("Unknown change type.");
  if (!["all", "people", "workspace", "other"].includes(area)) throw new Error("Unknown change area.");
  const rawOffset = params.get("offset") ?? "0";
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) throw new Error("Invalid history offset.");
  return { type: type as ChangeType, area: area as ChangeArea, offset: Number(rawOffset), limit: 50 };
}
export function changeWhere(filters: ChangeFilters) {
  const clauses: string[] = []; const args: string[] = [];
  const add = (actions: readonly string[], exclude = false) => {
    clauses.push(`action ${exclude ? "NOT IN" : "IN"} (${actions.map(() => "?").join(", ")})`);
    args.push(...actions);
  };
  if (filters.type === "other") add(knownActions, true);
  else if (filters.type !== "all") add(changeTypes.find((type) => type.value === filters.type)!.actions);
  if (filters.area === "other") add(knownActions, true);
  else if (filters.area !== "all") add(changeTypes.filter((type) => type.area === filters.area).flatMap((type) => [...type.actions]));
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}
