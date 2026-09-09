CREATE INDEX `idx_changes_created_at` ON `change_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_members_email` ON `members` (`email`);--> statement-breakpoint
CREATE INDEX `idx_members_entity` ON `members` (`entity`);--> statement-breakpoint
CREATE INDEX `idx_memberships_group_id` ON `memberships` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_member_period` ON `usage_records` (`member_id`,`period_end`);