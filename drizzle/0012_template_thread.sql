CREATE TABLE `template_thread` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`side` text NOT NULL,
	`score` integer NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	`closed_as` text,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "template_thread_side_check" CHECK("template_thread"."side" IN ('giver', 'taker')),
	CONSTRAINT "template_thread_score_check" CHECK("template_thread"."score" >= 1),
	CONSTRAINT "template_thread_closed_check" CHECK(("template_thread"."closed_at" IS NULL AND "template_thread"."closed_as" IS NULL) OR ("template_thread"."closed_at" IS NOT NULL AND "template_thread"."closed_as" IS NOT NULL AND "template_thread"."closed_as" IN ('replaced', 'accepted', 'closed')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_thread_open_offer_idx` ON `template_thread` (`template_id`) WHERE closed_at IS NULL AND side = 'giver';--> statement-breakpoint
CREATE UNIQUE INDEX `template_thread_open_bid_idx` ON `template_thread` (`template_id`,`user_id`) WHERE closed_at IS NULL AND side = 'taker';--> statement-breakpoint
CREATE INDEX `template_thread_template_idx` ON `template_thread` (`template_id`);