# Disputes (spec §5.11)

- `targets.ts`: `loadTarget` reads the disputed record: locked or not, its numbers, whose it is.
- `disputes.ts`: `openDisputeIn` (domain rule + row + `dispute.opened` in one transaction), `disputeMarks` (what an item shows).
- `list.ts`: `listDisputes`, the Rozporováno list on Týden → Historie.
- `functions.ts`: server functions, behind the launch switch `disputes`.

Keys (`item_kind` → `item_id`): `task_score` → `tasks.id` (locked once `agreed_at` is set), `template_score` → `templates.id` (active), `completion` → `tasks.id` (confirmed), `rejection` → the `task.rejected` entry's `audit_log.id`, `settlement` → `settlements.id`, `adjustment` → #48.
