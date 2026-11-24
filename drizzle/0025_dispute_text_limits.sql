-- Jakub 2026-11-24: reason up to 1000 characters. The rebuild drops the table's triggers, so they are re-created at the end.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` integer NOT NULL,
	`opened_by` integer NOT NULL,
	`reason` text NOT NULL,
	`opened_at` text NOT NULL,
	`status` text NOT NULL,
	`resolved_by` integer,
	`resolved_at` text,
	`note` text,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "disputes_kind_check" CHECK("__new_disputes"."item_kind" IN ('task_score', 'template_score', 'completion', 'rejection', 'settlement', 'adjustment')),
	CONSTRAINT "disputes_status_check" CHECK("__new_disputes"."status" IN ('open', 'dismissed', 'corrected')),
	CONSTRAINT "disputes_reason_check" CHECK(length(trim("__new_disputes"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "disputes_resolution_check" CHECK(("__new_disputes"."status" = 'open' AND "__new_disputes"."resolved_by" IS NULL AND "__new_disputes"."resolved_at" IS NULL AND "__new_disputes"."note" IS NULL) OR ("__new_disputes"."status" <> 'open' AND "__new_disputes"."resolved_by" IS NOT NULL AND "__new_disputes"."resolved_at" IS NOT NULL AND "__new_disputes"."note" IS NOT NULL)),
	CONSTRAINT "disputes_note_check" CHECK("__new_disputes"."status" = 'open' OR length(trim(coalesce("__new_disputes"."note", ''))) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_disputes`("id", "item_kind", "item_id", "opened_by", "reason", "opened_at", "status", "resolved_by", "resolved_at", "note") SELECT "id", "item_kind", "item_id", "opened_by", "reason", "opened_at", "status", "resolved_by", "resolved_at", "note" FROM `disputes`;--> statement-breakpoint
DROP TABLE `disputes`;--> statement-breakpoint
ALTER TABLE `__new_disputes` RENAME TO `disputes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `disputes_one_open_idx` ON `disputes` (`item_kind`,`item_id`) WHERE "disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX `disputes_item_idx` ON `disputes` (`item_kind`,`item_id`);--> statement-breakpoint
CREATE TRIGGER `disputes_no_delete` BEFORE DELETE ON `disputes`
BEGIN
	SELECT RAISE(ABORT, 'disputes are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `disputes_final` BEFORE UPDATE ON `disputes` WHEN OLD.`status` <> 'open'
BEGIN
	SELECT RAISE(ABORT, 'a closed dispute is final');
END;
