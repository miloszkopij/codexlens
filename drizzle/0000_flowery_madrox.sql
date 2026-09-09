CREATE TABLE `change_events` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text,
	`person` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`entity` text DEFAULT 'Unknown' NOT NULL,
	`kind` text NOT NULL,
	`unread` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'Manual' NOT NULL,
	`sync_version` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`workspace_role` text NOT NULL,
	`people_role` text,
	`department` text,
	`manager` text,
	`entity` text DEFAULT 'Unknown' NOT NULL,
	`company` text,
	`status` text DEFAULT 'Active' NOT NULL,
	`people_match` text DEFAULT 'Missing' NOT NULL,
	`sync_version` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`member_id` text NOT NULL,
	`group_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `group_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`users_count` integer DEFAULT 0 NOT NULL,
	`groups_count` integer DEFAULT 0 NOT NULL,
	`changes_count` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`amount` real NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'credits' NOT NULL,
	`source` text NOT NULL,
	`imported_at` text NOT NULL
);
