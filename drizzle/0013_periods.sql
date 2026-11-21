CREATE TABLE `periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`starts_at` text NOT NULL,
	`cutoff_at` text NOT NULL,
	`ended_at` text,
	`lower_level` integer NOT NULL,
	`upper_level` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "periods_span_check" CHECK("periods"."cutoff_at" > "periods"."starts_at"),
	CONSTRAINT "periods_levels_check" CHECK("periods"."lower_level" >= 1 AND "periods"."lower_level" <= "periods"."upper_level"),
	CONSTRAINT "periods_ended_check" CHECK("periods"."ended_at" IS NULL OR ("periods"."ended_at" > "periods"."starts_at" AND "periods"."ended_at" < "periods"."cutoff_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `periods_starts_at_idx` ON `periods` (`starts_at`);