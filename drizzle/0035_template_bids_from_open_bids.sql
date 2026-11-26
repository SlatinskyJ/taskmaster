-- Redo the 0034 backfill (#232): a proposed chore keeps 0 (its newest giver row is its floor), and
-- an agreed chore's floor sits just below its oldest open row, so bids in flight at deploy still
-- count for the same-number rule; with nothing open, its newest row.
UPDATE `templates` SET `bids_from` = CASE WHEN `status` = 'active' THEN coalesce(
  (SELECT min(`id`) - 1 FROM `template_thread` WHERE `template_id` = `templates`.`id` AND `closed_at` IS NULL),
  (SELECT max(`id`) FROM `template_thread` WHERE `template_id` = `templates`.`id`),
  0) ELSE 0 END;
