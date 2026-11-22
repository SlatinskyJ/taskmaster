-- Every launch switch on (Jakub 2026-11-22): recurring chores, Zapsat, Týden, Schůzka and the
-- week proposals are all built. Like the hand flip in src/server/features/README.md, this writes
-- no audit entry: the change is this file, in git history. Previews and e2e servers set their own
-- switches afterwards from their seed (src/server/demo/seeds.ts).
UPDATE `feature_flags` SET `enabled` = 1;
