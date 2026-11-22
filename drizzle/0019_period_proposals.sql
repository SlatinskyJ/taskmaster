CREATE TABLE `defaults_proposal_approvals` (
	`proposal_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `user_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `defaults_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dpa_user_idx` ON `defaults_proposal_approvals` (`user_id`);--> statement-breakpoint
CREATE TABLE `defaults_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`length_days` integer NOT NULL,
	`cutoff_weekday` integer NOT NULL,
	`cutoff_hour` integer NOT NULL,
	`cutoff_minute` integer NOT NULL,
	`lower_level` integer NOT NULL,
	`upper_level` integer NOT NULL,
	`proposed_by` integer NOT NULL,
	`status` text NOT NULL,
	`closed_by` integer,
	`created_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`proposed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "defaults_proposals_status_check" CHECK("defaults_proposals"."status" IN ('pending', 'agreed', 'rejected', 'withdrawn')),
	CONSTRAINT "defaults_proposals_length_check" CHECK("defaults_proposals"."length_days" BETWEEN 7 AND 364 AND "defaults_proposals"."length_days" % 7 = 0),
	CONSTRAINT "defaults_proposals_cutoff_check" CHECK("defaults_proposals"."cutoff_weekday" BETWEEN 0 AND 6 AND "defaults_proposals"."cutoff_hour" BETWEEN 0 AND 23 AND "defaults_proposals"."cutoff_minute" BETWEEN 0 AND 59),
	CONSTRAINT "defaults_proposals_levels_check" CHECK("defaults_proposals"."lower_level" >= 1 AND "defaults_proposals"."lower_level" <= "defaults_proposals"."upper_level")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `defaults_proposals_pending_idx` ON `defaults_proposals` (`status`) WHERE "defaults_proposals"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `period_proposal_approvals` (
	`proposal_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `user_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `period_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ppa_user_idx` ON `period_proposal_approvals` (`user_id`);--> statement-breakpoint
CREATE TABLE `period_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`after_period_id` integer NOT NULL,
	`cutoff_at` text NOT NULL,
	`lower_level` integer NOT NULL,
	`upper_level` integer NOT NULL,
	`proposed_by` integer NOT NULL,
	`status` text NOT NULL,
	`closed_by` integer,
	`created_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`after_period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "period_proposals_status_check" CHECK("period_proposals"."status" IN ('pending', 'agreed', 'rejected', 'withdrawn', 'lapsed')),
	CONSTRAINT "period_proposals_levels_check" CHECK("period_proposals"."lower_level" >= 1 AND "period_proposals"."lower_level" <= "period_proposals"."upper_level")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `period_proposals_open_idx` ON `period_proposals` (`after_period_id`) WHERE "period_proposals"."status" IN ('pending', 'agreed');--> statement-breakpoint
-- Launch switch for proposals (#43): off until Jakub turns it on.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('periodProposals', 0);
