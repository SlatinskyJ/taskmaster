-- Settlement corrections and point adjustments (spec §5.9, #48). Both are append-only: triggers at the end.
CREATE TABLE `point_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taker_id` integer NOT NULL,
	`points` integer NOT NULL,
	`reason` text NOT NULL,
	`correction_id` integer,
	`dispute_id` integer,
	`made_by` integer NOT NULL,
	`made_at` text NOT NULL,
	FOREIGN KEY (`taker_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`correction_id`) REFERENCES `settlement_corrections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`made_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "point_adjustments_points_check" CHECK("point_adjustments"."points" <> 0),
	CONSTRAINT "point_adjustments_reason_check" CHECK(length(trim("point_adjustments"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_adjustments_correction_id_unique` ON `point_adjustments` (`correction_id`);--> statement-breakpoint
CREATE INDEX `point_adjustments_taker_idx` ON `point_adjustments` (`taker_id`);--> statement-breakpoint
CREATE TABLE `settlement_corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settlement_id` integer NOT NULL,
	`level` text NOT NULL,
	`deducted` integer NOT NULL,
	`reason` text NOT NULL,
	`dispute_id` integer,
	`made_by` integer NOT NULL,
	`made_at` text NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`made_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlement_corrections_level_check" CHECK("settlement_corrections"."level" IN ('none', 'lower', 'upper')),
	CONSTRAINT "settlement_corrections_deducted_check" CHECK("settlement_corrections"."deducted" >= 0 AND ("settlement_corrections"."level" = 'none') = ("settlement_corrections"."deducted" = 0)),
	CONSTRAINT "settlement_corrections_reason_check" CHECK(length(trim("settlement_corrections"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE INDEX `settlement_corrections_settlement_idx` ON `settlement_corrections` (`settlement_id`);--> statement-breakpoint
CREATE TRIGGER `settlement_corrections_no_update` BEFORE UPDATE ON `settlement_corrections`
BEGIN
	SELECT RAISE(ABORT, 'settlement corrections are final');
END;
--> statement-breakpoint
CREATE TRIGGER `settlement_corrections_no_delete` BEFORE DELETE ON `settlement_corrections`
BEGIN
	SELECT RAISE(ABORT, 'settlement corrections are final');
END;
--> statement-breakpoint
CREATE TRIGGER `point_adjustments_no_update` BEFORE UPDATE ON `point_adjustments`
BEGIN
	SELECT RAISE(ABORT, 'point adjustments are final');
END;
--> statement-breakpoint
CREATE TRIGGER `point_adjustments_no_delete` BEFORE DELETE ON `point_adjustments`
BEGIN
	SELECT RAISE(ABORT, 'point adjustments are final');
END;
