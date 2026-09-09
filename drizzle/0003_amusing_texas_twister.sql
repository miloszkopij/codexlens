ALTER TABLE `change_events` ADD `actor_name` text;--> statement-breakpoint
ALTER TABLE `change_events` ADD `actor_email` text;--> statement-breakpoint
ALTER TABLE `change_events` ADD `actor_source` text DEFAULT 'Legacy snapshot' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `added_at` text;--> statement-breakpoint
ALTER TABLE `members` ADD `added_by_name` text;--> statement-breakpoint
ALTER TABLE `members` ADD `added_by_email` text;--> statement-breakpoint
ALTER TABLE `members` ADD `addition_source` text DEFAULT 'Directory sync' NOT NULL;