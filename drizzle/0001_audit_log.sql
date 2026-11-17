CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text,
	CONSTRAINT "audit_log_actor_check" CHECK(("audit_log"."actor_kind" = 'user') = ("audit_log"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "audit_log_before_json" CHECK("audit_log"."before" IS NULL OR json_valid("audit_log"."before")),
	CONSTRAINT "audit_log_after_json" CHECK("audit_log"."after" IS NULL OR json_valid("audit_log"."after"))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);