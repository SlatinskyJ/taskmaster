ALTER TABLE `tasks` ADD `reserved_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `reserved_via` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reserved_giver_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `earner_id` integer REFERENCES users(id);