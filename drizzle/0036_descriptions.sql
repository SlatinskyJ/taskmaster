CREATE TABLE `description_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer,
	`template_id` integer,
	`description` text,
	`proposed_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	`closed_as` text,
	`closed_by` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "description_changes_target_check" CHECK(("description_changes"."task_id" IS NULL) <> ("description_changes"."template_id" IS NULL)),
	CONSTRAINT "description_changes_closed_check" CHECK(("description_changes"."closed_at" IS NULL AND "description_changes"."closed_as" IS NULL) OR ("description_changes"."closed_at" IS NOT NULL AND "description_changes"."closed_as" IS NOT NULL AND "description_changes"."closed_as" IN ('agreed', 'applied', 'declined', 'withdrawn', 'replaced', 'discarded')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `description_changes_open_task_idx` ON `description_changes` (`task_id`) WHERE closed_at IS NULL AND task_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `description_changes_open_template_idx` ON `description_changes` (`template_id`) WHERE closed_at IS NULL AND template_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `description_changes_task_idx` ON `description_changes` (`task_id`);--> statement-breakpoint
CREATE INDEX `description_changes_template_idx` ON `description_changes` (`template_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `description` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `description` text;