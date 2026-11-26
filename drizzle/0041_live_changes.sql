ALTER TABLE `audit_log` ADD `change_id` integer;--> statement-breakpoint
CREATE INDEX `audit_log_change_idx` ON `audit_log` (`change_id`);
--> statement-breakpoint
-- Launch switch for live change notices (#299). Off until Jakub turns it on.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('liveChanges', 0);
