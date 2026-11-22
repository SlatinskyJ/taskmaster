PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`offer_round` integer DEFAULT 1 NOT NULL,
	`approval_required` integer NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`agreed_at` text,
	`reserved_by` integer,
	`reserved_via` text,
	`reserved_giver_id` integer,
	`completed_by` integer,
	`completed_at` text,
	`earner_id` integer,
	`template_id` integer,
	`origin` text DEFAULT 'one_time' NOT NULL,
	`due_at` text,
	`grace_ends_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reserved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reserved_giver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`earner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status_check" CHECK("__new_tasks"."status" IN ('proposed', 'open', 'reserved', 'done_unconfirmed', 'confirmed', 'cancelled', 'expired', 'rejected')),
	CONSTRAINT "tasks_origin_check" CHECK("__new_tasks"."origin" IN ('one_time', 'on_demand', 'self_logged', 'scheduled') AND ("__new_tasks"."origin" = 'one_time') = ("__new_tasks"."template_id" IS NULL)),
	CONSTRAINT "tasks_deadline_check" CHECK(("__new_tasks"."due_at" IS NULL AND "__new_tasks"."grace_ends_at" IS NULL) OR ("__new_tasks"."due_at" IS NOT NULL AND "__new_tasks"."grace_ends_at" IS NOT NULL AND "__new_tasks"."template_id" IS NOT NULL)),
	CONSTRAINT "tasks_score_check" CHECK("__new_tasks"."score" >= 1),
	CONSTRAINT "tasks_title_check" CHECK(length(trim("__new_tasks"."title")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "title", "status", "score", "offer_round", "approval_required", "created_by", "created_at", "updated_at", "agreed_at", "reserved_by", "reserved_via", "reserved_giver_id", "completed_by", "completed_at", "earner_id") SELECT "id", "title", "status", "score", "offer_round", "approval_required", "created_by", "created_at", "updated_at", "agreed_at", "reserved_by", "reserved_via", "reserved_giver_id", "completed_by", "completed_at", "earner_id" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_template_idx` ON `tasks` (`template_id`);