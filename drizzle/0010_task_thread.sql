CREATE TABLE `task_thread` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`side` text NOT NULL,
	`score` integer NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	`closed_as` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_thread_side_check" CHECK("task_thread"."side" IN ('giver', 'taker')),
	CONSTRAINT "task_thread_score_check" CHECK("task_thread"."score" >= 1),
	CONSTRAINT "task_thread_closed_check" CHECK(("task_thread"."closed_at" IS NULL AND "task_thread"."closed_as" IS NULL) OR ("task_thread"."closed_at" IS NOT NULL AND "task_thread"."closed_as" IS NOT NULL AND "task_thread"."closed_as" IN ('replaced', 'accepted', 'closed')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_thread_open_offer_idx` ON `task_thread` (`task_id`) WHERE closed_at IS NULL AND side = 'giver';--> statement-breakpoint
CREATE UNIQUE INDEX `task_thread_open_bid_idx` ON `task_thread` (`task_id`,`user_id`) WHERE closed_at IS NULL AND side = 'taker';--> statement-breakpoint
CREATE INDEX `task_thread_task_idx` ON `task_thread` (`task_id`);