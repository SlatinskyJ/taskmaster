ALTER TABLE `tasks` ADD `plan_day_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `week_rules` integer DEFAULT false NOT NULL;