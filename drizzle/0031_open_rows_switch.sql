-- Launch switch for rows that open their task or chore page (#205). Off until Jakub turns it
-- on.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('openRows', 0);
