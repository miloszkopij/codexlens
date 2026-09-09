import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  workspaceRole: text("workspace_role").notNull(),
  peopleRole: text("people_role"),
  department: text("department"),
  manager: text("manager"),
  entity: text("entity").notNull().default("Unknown"),
  company: text("company"),
  status: text("status").notNull().default("Active"),
  peopleMatch: text("people_match").notNull().default("Missing"),
  addedAt: text("added_at"),
  addedByName: text("added_by_name"),
  addedByEmail: text("added_by_email"),
  additionSource: text("addition_source").notNull().default("Directory sync"),
  syncVersion: text("sync_version").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_members_email").on(table.email),
  index("idx_members_entity").on(table.entity),
]);

export const groups = sqliteTable("workspace_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  source: text("source").notNull().default("Manual"),
  syncVersion: text("sync_version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const memberships = sqliteTable("memberships", {
  memberId: text("member_id").notNull(),
  groupId: text("group_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.memberId, table.groupId] }),
  index("idx_memberships_group_id").on(table.groupId),
]);

export const changeEvents = sqliteTable("change_events", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id"),
  person: text("person").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  entity: text("entity").notNull().default("Unknown"),
  kind: text("kind").notNull(),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),
  actorSource: text("actor_source").notNull().default("Legacy snapshot"),
  unread: integer("unread", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_changes_created_at").on(table.createdAt)]);

export const usageRecords = sqliteTable("usage_records", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  amount: real("amount").notNull(),
  messages: integer("messages").notNull().default(0),
  unit: text("unit").notNull().default("credits"),
  source: text("source").notNull(),
  importedAt: text("imported_at").notNull(),
}, (table) => [
  index("idx_usage_member_period").on(table.memberId, table.periodEnd),
  index("idx_usage_period_end").on(table.periodEnd),
]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  usersCount: integer("users_count").notNull().default(0),
  groupsCount: integer("groups_count").notNull().default(0),
  changesCount: integer("changes_count").notNull().default(0),
  error: text("error"),
});
