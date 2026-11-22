CREATE TABLE `disputes` (
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
	CONSTRAINT "disputes_kind_check" CHECK("disputes"."item_kind" IN ('task_score', 'template_score', 'completion', 'rejection', 'settlement', 'adjustment')),
	CONSTRAINT "disputes_status_check" CHECK("disputes"."status" IN ('open', 'dismissed', 'corrected')),
	CONSTRAINT "disputes_reason_check" CHECK(length(trim("disputes"."reason")) BETWEEN 1 AND 200),
	CONSTRAINT "disputes_resolution_check" CHECK(("disputes"."status" = 'open' AND "disputes"."resolved_by" IS NULL AND "disputes"."resolved_at" IS NULL AND "disputes"."note" IS NULL) OR ("disputes"."status" <> 'open' AND "disputes"."resolved_by" IS NOT NULL AND "disputes"."resolved_at" IS NOT NULL AND "disputes"."note" IS NOT NULL)),
	CONSTRAINT "disputes_note_check" CHECK("disputes"."status" = 'open' OR length(trim(coalesce("disputes"."note", ''))) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `disputes_one_open_idx` ON `disputes` (`item_kind`,`item_id`) WHERE "disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX `disputes_item_idx` ON `disputes` (`item_kind`,`item_id`);--> statement-breakpoint
-- Disputes are never deleted, and a closed one is final (spec §5.10, §5.11): the only update is
-- the one that closes an open dispute.
CREATE TRIGGER `disputes_no_delete` BEFORE DELETE ON `disputes`
BEGIN
	SELECT RAISE(ABORT, 'disputes are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `disputes_final` BEFORE UPDATE ON `disputes` WHEN OLD.`status` <> 'open'
BEGIN
	SELECT RAISE(ABORT, 'a closed dispute is final');
END;
