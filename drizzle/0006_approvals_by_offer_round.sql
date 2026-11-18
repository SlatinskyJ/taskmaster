PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_score_approvals` (
	`task_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`offer_round` integer NOT NULL,
	`score` integer NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`task_id`, `offer_round`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_task_score_approvals`("task_id", "user_id", "offer_round", "score", "approved_at") SELECT "task_id", "user_id", 1, "score", "approved_at" FROM `task_score_approvals`;--> statement-breakpoint
DROP TABLE `task_score_approvals`;--> statement-breakpoint
ALTER TABLE `__new_task_score_approvals` RENAME TO `task_score_approvals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `tasks` ADD `offer_round` integer DEFAULT 1 NOT NULL;