CREATE TABLE `task_score_approvals` (
	`task_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`score` integer NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`task_id`, `score`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`approval_required` integer NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`agreed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" IN ('proposed', 'open', 'reserved', 'done_unconfirmed', 'confirmed', 'cancelled')),
	CONSTRAINT "tasks_score_check" CHECK("tasks"."score" >= 1),
	CONSTRAINT "tasks_title_check" CHECK(length(trim("tasks"."title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);