-- Launch switch for approving done work from the task page and Úkoly (#206). Off until Jakub
-- turns it on.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('approveAnywhere', 0);
