# Domain layer (spec §5)

Plain TypeScript for the section 5 rules: agreement, lifecycle, periods, settlement.

No framework, DB or Node imports here (React, TanStack, Drizzle, `better-sqlite3`, `node:*`).
ESLint enforces this. Server functions are thin wrappers that call into this folder.

## How the modules meet

- `agreement.ts` owns the **score**: who proposed and approved it, and when a negotiation ends.
- `lifecycle.ts` owns the **item state** (proposed, open, reserved, done, …) and who may move it.
- Both call "still negotiating" `proposed`. A server function applies both in one transaction:
  agreement agreed → `markAgreed`; `releaseReservation` back to `proposed` → `reopenOneTimeOffer`.
- Actors: lifecycle steps take an `Actor` (a person or the scheduler); agreement steps take the
  people list plus an id, because they re-check every approval against current people.
- Bidding (`bidding.ts`) works on the one-time task's agreement. When it returns `open`, call
  `markAgreed(item, null)`; when it returns `reserved`, call `markAgreed(item, { takerId, giverId })`.
  `bids.ts` holds the raw bid book; it is internal (not exported from `index.ts`), so callers go
  through the checked actions.
- Periods (`periods.ts`) build the chain of periods and say which period an instant falls in
  (`periodAt`, half-open: exactly at the cutoff is the next period). A scheduler job calls
  `periodsToStart` at each cutoff, then `lapsePeriodSettings` on proposals for the period that
  just started. Settlement (`settlement.ts`) takes the period's levels.
- Disputes (`disputes.ts`) flag a locked record and hold the admin's outcome. A correction is
  written with `correctSettlement` / `adjustPoints` (`settlement.ts`) in the same transaction as
  `correctDispute`.
  `CompletionOutcome` (pending / confirmed / rejected) describes a stored completion record; a
  rejected completion of a normal item leaves no trace on the item itself (`lifecycle.ts`), so
  the record lives in its own table.
- Templates (`templates.ts`) check a recurring template's schedule and deadline rule
  (`validateTemplateDefinition`). Its score agreement lives in `agreement.ts` like any other.
