-- Reopened bidding on an open one-time task (#212): the round marker, and its launch switch (off
-- until Jakub turns it on).
ALTER TABLE `tasks` ADD `bidding_from` integer;--> statement-breakpoint
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('reopenBidding', 0);
