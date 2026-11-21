-- Every task that exists gets its first offer in the thread. Until this release every score was
-- agreed by approving the creator's offer (no code could accept a bid), so a task that is no
-- longer proposed was agreed at that offer.
INSERT INTO `task_thread` (`task_id`, `user_id`, `side`, `score`, `created_at`, `closed_at`, `closed_as`)
SELECT `id`, `created_by`, 'giver', `score`, `created_at`,
  CASE WHEN `status` = 'proposed' THEN NULL ELSE coalesce(`agreed_at`, `updated_at`) END,
  CASE WHEN `status` = 'proposed' THEN NULL ELSE 'accepted' END
FROM `tasks`;
