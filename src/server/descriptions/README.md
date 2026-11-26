# Descriptions (#207)

What done means for a one-time task or a chore (spec §4, §5.1–§5.3). The rules are in `src/domain/description.ts`; this module writes `tasks.description`, `templates.description` and the waiting changes in `description_changes`, with their audit entries.

- Proposed: a giver's change applies at once and the agreement starts over at the same score (Jakub 2026-11-26). Agreed: it waits for one taker's OK (reserved: the reserver's); one waits at a time, a new one replaces it.
- A lifecycle step settles a waiting task change (`settleStaleDescription`): back to proposed applies it, done, cancelled or expired discards it, open ↔ reserved keeps it.
- A taker's yes, pick or bid may carry the text his page showed (`seenDescription`); a different one is `offer_changed`.
- Instances copy the chore's text when made and never change.
