CREATE TABLE `template_score_approvals` (
	`template_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`score` integer NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`template_id`, `user_id`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`approval_required` integer NOT NULL,
	`schedule_days` integer DEFAULT 0 NOT NULL,
	`schedule_time` text,
	`due_day_offset` integer,
	`due_time` text,
	`grace_minutes` integer,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`agreed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "templates_status_check" CHECK("templates"."status" IN ('proposed', 'active')),
	CONSTRAINT "templates_score_check" CHECK("templates"."score" >= 1),
	CONSTRAINT "templates_title_check" CHECK(length(trim("templates"."title")) > 0),
	CONSTRAINT "templates_days_check" CHECK("templates"."schedule_days" BETWEEN 0 AND 127),
	CONSTRAINT "templates_time_check" CHECK("templates"."schedule_time" IS NULL OR "templates"."schedule_days" > 0),
	CONSTRAINT "templates_deadline_check" CHECK(("templates"."due_day_offset" IS NULL) = ("templates"."due_time" IS NULL) AND ("templates"."due_time" IS NULL) = ("templates"."grace_minutes" IS NULL)),
	CONSTRAINT "templates_offset_check" CHECK("templates"."due_day_offset" BETWEEN 0 AND 6),
	CONSTRAINT "templates_grace_check" CHECK("templates"."grace_minutes" BETWEEN 0 AND 2880)
);
--> statement-breakpoint
CREATE INDEX `templates_status_idx` ON `templates` (`status`);