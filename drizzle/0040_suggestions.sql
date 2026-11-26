CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`issue_url` text,
	`issue_number` integer,
	`sent_title` text,
	`sent_body` text,
	`sent_at` text,
	`closed_by` integer,
	`closed_at` text,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestions_status_check" CHECK("suggestions"."status" IN ('new', 'sent', 'done', 'dismissed')),
	CONSTRAINT "suggestions_title_check" CHECK(length("suggestions"."title") BETWEEN 1 AND 120),
	CONSTRAINT "suggestions_description_check" CHECK("suggestions"."description" IS NULL OR length("suggestions"."description") BETWEEN 1 AND 2000),
	CONSTRAINT "suggestions_sent_check" CHECK(("suggestions"."issue_url" IS NULL AND "suggestions"."issue_number" IS NULL AND "suggestions"."sent_title" IS NULL AND "suggestions"."sent_body" IS NULL AND "suggestions"."sent_at" IS NULL) OR ("suggestions"."issue_url" IS NOT NULL AND "suggestions"."issue_number" IS NOT NULL AND "suggestions"."sent_title" IS NOT NULL AND "suggestions"."sent_body" IS NOT NULL AND "suggestions"."sent_at" IS NOT NULL)),
	CONSTRAINT "suggestions_sent_status_check" CHECK(("suggestions"."status" <> 'sent' OR "suggestions"."issue_url" IS NOT NULL) AND ("suggestions"."status" NOT IN ('new', 'dismissed') OR "suggestions"."issue_url" IS NULL)),
	CONSTRAINT "suggestions_closed_check" CHECK(("suggestions"."status" IN ('done', 'dismissed')) = ("suggestions"."closed_by" IS NOT NULL AND "suggestions"."closed_at" IS NOT NULL) AND ("suggestions"."closed_by" IS NULL) = ("suggestions"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `suggestions_author_idx` ON `suggestions` (`author_id`);--> statement-breakpoint
-- Suggestions are never deleted, done and dismissed are final, and the author's text and the
-- sent text never change (spec §5.13, #247). The CHECKs tie the sent and closing fields to the
-- state, so a sent row can't go back to new or be dismissed.
CREATE TRIGGER `suggestions_no_delete` BEFORE DELETE ON `suggestions`
BEGIN
	SELECT RAISE(ABORT, 'suggestions are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `suggestions_final` BEFORE UPDATE ON `suggestions`
WHEN OLD.`status` IN ('done', 'dismissed')
BEGIN
	SELECT RAISE(ABORT, 'a done or dismissed suggestion is final');
END;
--> statement-breakpoint
CREATE TRIGGER `suggestions_fixed` BEFORE UPDATE ON `suggestions`
WHEN NEW.`author_id` IS NOT OLD.`author_id`
	OR NEW.`title` IS NOT OLD.`title`
	OR NEW.`description` IS NOT OLD.`description`
	OR NEW.`created_at` IS NOT OLD.`created_at`
	OR (OLD.`issue_url` IS NOT NULL AND (
		NEW.`issue_url` IS NOT OLD.`issue_url`
		OR NEW.`issue_number` IS NOT OLD.`issue_number`
		OR NEW.`sent_title` IS NOT OLD.`sent_title`
		OR NEW.`sent_body` IS NOT OLD.`sent_body`
		OR NEW.`sent_at` IS NOT OLD.`sent_at`))
BEGIN
	SELECT RAISE(ABORT, 'a suggestion''s text and sent issue never change');
END;
--> statement-breakpoint
-- Launch switch for in-app suggestions (#247). Off until Jakub turns it on.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('suggestions', 0);
