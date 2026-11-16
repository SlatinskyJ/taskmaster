---
name: judge-rules
description: Use when acting as the Rules judge in a Taskmaster pull request review round, or when a PR touches the domain layer, points, task states, periods, settlement or the audit log and needs checking against spec section 5
---

# Rules judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** does the code do what spec §5 says? Wrong points or a broken rule here means the family argues, which the app exists to prevent.

## Check

- **Lifecycle (§5.6):** only the transitions in the diagram exist. A rejected completion returns to *reserved by the same taker* if it was reserved, otherwise to open. A rejected self-logged chore closes as rejected.
- **Agreement (§5.1, §5.2):** "all parties" = all active givers + all active takers. The admin is never a party. The first bid to reach agreement wins, and other bids close. A score is frozen after completion.
- **Reservation (§5.4):** only the reserving taker completes for points. A giver may complete, with no points.
- **Completion (§5.5):** approval flag on → `done_unconfirmed`; off → `confirmed`. Self-logged always needs approval. `completed_at` is stored.
- **Periods (§5.8):** a period runs from the previous cutoff (inclusive) to its own cutoff (exclusive). Attribution uses `completed_at`, not approval time. Length and levels are locked once a period starts.
- **Settlement (§5.9):** total ≥ upper → deduct upper; ≥ lower → deduct lower; else nothing. Never negative. Settlements are final; a correction is a new record plus a forward adjustment.
- **Audit (§5.10):** every state change writes its audit entry in the **same transaction**, with actor, action, entity, before/after. No hard deletes. Running totals can be rebuilt from the log + settlements.
- **Check-then-write:** the state check and the write happen inside one transaction, so two requests at once can't both pass (double completion, double points).
- **Time:** all rules use Europe/Prague. Boundaries are compared on instants, not strings.

## Not your lane

| Concern | Judge |
| --- | --- |
| Role checks as an attack surface, input validation | Security |
| Code shape, duplication, shared types | Architecture |
| Missing or weak tests | Tests |
| Screens, Czech labels | UX |

A role check that §5 requires (e.g. reservation) is yours. Generic authorization hardening is Security's.

## Common mistakes

- Reporting the same rule break twice, once per file. One finding at the line that breaks the rule.
- Citing a spec rule without the `Failure:` line. "Breaks §5.10" is a claim; "audit insert throws → task stays completed with no log entry" is evidence.
