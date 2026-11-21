CREATE TABLE `settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_id` integer NOT NULL,
	`taker_id` integer NOT NULL,
	`total_before` integer NOT NULL,
	`level` text NOT NULL,
	`deducted` integer NOT NULL,
	`carry_over` integer NOT NULL,
	`settled_by` integer NOT NULL,
	`settled_at` text NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taker_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlements_points_check" CHECK("settlements"."total_before" >= 0 AND "settlements"."deducted" >= 0 AND "settlements"."carry_over" >= 0 AND "settlements"."carry_over" = "settlements"."total_before" - "settlements"."deducted"),
	CONSTRAINT "settlements_level_check" CHECK("settlements"."level" IN ('none', 'lower', 'upper')),
	CONSTRAINT "settlements_deducted_check" CHECK(("settlements"."level" = 'none') = ("settlements"."deducted" = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_period_taker_idx` ON `settlements` (`period_id`,`taker_id`);