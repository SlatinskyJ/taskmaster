-- Launch switch for #211: settle the running week only on its last day. Written ON: Jakub
-- (2026-11-24) asked for it to be flipped once merged, before the Sunday 29 Nov meeting, so the
-- merge is the flip. Like 0022, no audit entry: the change is this file. Turn it off by hand with
-- the command in src/server/features/README.md.
INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('settleLastDay', 1);
