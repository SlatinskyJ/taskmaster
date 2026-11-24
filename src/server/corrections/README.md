# Corrections and point adjustments (spec §5.9, §5.11)

- `read.ts`: `latestCorrection` (a settlement's newest correction) and `toCorrection`. A leaf: only the schema and the domain. The dispute targets read a settlement's effective value through it.
- `corrections.ts`: `adjustPointsIn` (the admin adds or removes points with a reason) and `correctSettlementIn` (the admin sets the level a final settlement should have had; the difference goes to today's total as an adjustment). Either one can resolve an open dispute (`from`): the dispute closes as `corrected` with the reason as its note. One transaction each, with `points.adjusted`, `settlement.corrected` and `dispute.corrected`.
- A removal (a negative adjustment, or a correction that removes points) is refused with `week_waiting` while an ended week waits for its meeting (`weekWaiting` in `~/server/settlement`).

Imports go one way: corrections → disputes, settlement. Never back; `~/server/disputes/targets.ts` imports only `./read`.

Tables: `settlement_corrections`, `point_adjustments` (append-only, migration 0026). The ledger (`~/server/settlement/ledger.ts`) counts every adjustment in the week of its `made_at`.
