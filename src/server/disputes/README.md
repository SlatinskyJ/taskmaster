# Disputes (spec §5.11)

- `targets.ts`: `loadTarget` reads the disputed record: locked or not, its numbers, whose it is.
- `disputes.ts`: `openDisputeIn` (domain rule + row + `dispute.opened` in one transaction), `dismissDisputeIn` (the admin keeps the item, with a note; refused with `value_changed` when the item's value moved since the admin saw it; `dispute.dismissed`), `disputeMarks` (what an item shows).
- `list.ts`: `listDisputes`, the Rozporováno list on Týden → Historie; `listOpenForAdmin`, the admin's Sporné on Správa (every open dispute, oldest first, with the item's value now).
- `functions.ts`: server functions, behind the launch switch `disputes`. Opening and marks: givers and takers; the admin list and dismiss: admin only.

Keys (`item_kind` → `item_id`): `task_score` → `tasks.id` (locked once `agreed_at` is set), `template_score` → `templates.id` (active), `completion` → `tasks.id` (confirmed), `rejection` → the `task.rejected` entry's `audit_log.id`, `settlement` → `settlements.id`, `adjustment` → #48.
