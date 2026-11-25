-- Launch switch for changing your own password on Profil (#210). Off until Jakub turns it on.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('passwordChange', 0);
