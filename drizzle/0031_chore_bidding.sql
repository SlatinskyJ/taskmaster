-- Bidding on a proposed chore (#209): offer rounds for a proposed template's approvals (existing
-- rows are round 1), and the launch switch (off until Jakub turns it on).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_template_score_approvals` (
	`template_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`score` integer NOT NULL,
	`approved_at` text NOT NULL,
	`offer_round` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`template_id`, `offer_round`, `user_id`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_template_score_approvals`("template_id", "user_id", "score", "approved_at", "offer_round") SELECT "template_id", "user_id", "score", "approved_at", 1 FROM `template_score_approvals`;--> statement-breakpoint
DROP TABLE `template_score_approvals`;--> statement-breakpoint
ALTER TABLE `__new_template_score_approvals` RENAME TO `template_score_approvals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `templates` ADD `offer_round` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('choreBidding', 0);
