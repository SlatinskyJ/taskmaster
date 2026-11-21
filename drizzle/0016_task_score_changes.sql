CREATE TABLE `task_score_change_approvals` (
	`change_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`change_id`, `user_id`),
	FOREIGN KEY (`change_id`) REFERENCES `task_score_changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_score_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`score` integer NOT NULL,
	`proposed_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	`closed_as` text,
	`closed_by` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_score_changes_score_check" CHECK("task_score_changes"."score" >= 1),
	CONSTRAINT "task_score_changes_closed_check" CHECK(("task_score_changes"."closed_at" IS NULL AND "task_score_changes"."closed_as" IS NULL) OR ("task_score_changes"."closed_at" IS NOT NULL AND "task_score_changes"."closed_as" IS NOT NULL AND "task_score_changes"."closed_as" IN ('agreed', 'declined', 'withdrawn', 'discarded')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_score_changes_open_idx` ON `task_score_changes` (`task_id`) WHERE closed_at IS NULL;--> statement-breakpoint
CREATE INDEX `task_score_changes_task_idx` ON `task_score_changes` (`task_id`);