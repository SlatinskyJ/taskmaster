CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	CONSTRAINT "feature_flags_enabled_check" CHECK("feature_flags"."enabled" IN (0, 1))
);
--> statement-breakpoint
-- Launch values (family launch 2026-11-22: one-time tasks only).
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('recurring', 0), ('log', 0), ('week', 0), ('meeting', 0);
