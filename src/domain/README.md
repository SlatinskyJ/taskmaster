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
