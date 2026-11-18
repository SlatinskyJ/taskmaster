PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_templates` (
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
	CONSTRAINT "templates_status_check" CHECK("__new_templates"."status" IN ('proposed', 'active')),
	CONSTRAINT "templates_score_check" CHECK("__new_templates"."score" >= 1),
	CONSTRAINT "templates_title_check" CHECK(length(trim("__new_templates"."title")) > 0),
	CONSTRAINT "templates_days_check" CHECK("__new_templates"."schedule_days" BETWEEN 0 AND 127),
	CONSTRAINT "templates_time_check" CHECK("__new_templates"."schedule_time" IS NULL OR "__new_templates"."schedule_days" > 0),
	CONSTRAINT "templates_deadline_check" CHECK(("__new_templates"."due_day_offset" IS NULL) = ("__new_templates"."due_time" IS NULL) AND ("__new_templates"."due_time" IS NULL) = ("__new_templates"."grace_minutes" IS NULL)),
	CONSTRAINT "templates_offset_check" CHECK("__new_templates"."due_day_offset" >= 0),
	CONSTRAINT "templates_grace_check" CHECK("__new_templates"."grace_minutes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_templates`("id", "title", "status", "score", "approval_required", "schedule_days", "schedule_time", "due_day_offset", "due_time", "grace_minutes", "created_by", "created_at", "updated_at", "agreed_at") SELECT "id", "title", "status", "score", "approval_required", "schedule_days", "schedule_time", "due_day_offset", "due_time", "grace_minutes", "created_by", "created_at", "updated_at", "agreed_at" FROM `templates`;--> statement-breakpoint
DROP TABLE `templates`;--> statement-breakpoint
ALTER TABLE `__new_templates` RENAME TO `templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `templates_status_idx` ON `templates` (`status`);