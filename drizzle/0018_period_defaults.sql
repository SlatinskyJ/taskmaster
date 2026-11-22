CREATE TABLE `period_defaults` (
	`id` integer PRIMARY KEY NOT NULL,
	`length_days` integer NOT NULL,
	`cutoff_weekday` integer NOT NULL,
	`cutoff_hour` integer NOT NULL,
	`cutoff_minute` integer NOT NULL,
	`lower_level` integer NOT NULL,
	`upper_level` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "period_defaults_singleton_check" CHECK("period_defaults"."id" = 1),
	CONSTRAINT "period_defaults_length_check" CHECK("period_defaults"."length_days" BETWEEN 7 AND 364 AND "period_defaults"."length_days" % 7 = 0),
	CONSTRAINT "period_defaults_cutoff_check" CHECK("period_defaults"."cutoff_weekday" BETWEEN 0 AND 6 AND "period_defaults"."cutoff_hour" BETWEEN 0 AND 23 AND "period_defaults"."cutoff_minute" BETWEEN 0 AND 59),
	CONSTRAINT "period_defaults_levels_check" CHECK("period_defaults"."lower_level" >= 1 AND "period_defaults"."lower_level" <= "period_defaults"."upper_level")
);
--> statement-breakpoint
-- The default week from the spec (§5.8): 7 days, cutoff Sunday 23:59 Europe/Prague, levels 50/100.
INSERT INTO `period_defaults` (`id`, `length_days`, `cutoff_weekday`, `cutoff_hour`, `cutoff_minute`, `lower_level`, `upper_level`, `updated_at`, `updated_by`) VALUES (1, 7, 0, 23, 59, 50, 100, '2026-11-22T00:00:00.000Z', NULL);
