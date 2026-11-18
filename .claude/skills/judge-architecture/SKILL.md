---
name: judge-architecture
description: Use when acting as the Architecture judge in a Taskmaster pull request review round, or when a code PR needs checking for fit with existing patterns, layering, migrations, dependencies or blast radius
---

# Architecture judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** will this code still be easy to change in a year, and what else does it affect? You also confirm or reject a builder's "trivial" label.

## Check

- **Layering:** the §5 domain layer (`src/domain/`) imports no framework, DB driver or UI code. Server functions are thin wrappers.
- **One way of doing things:** the PR follows the existing pattern for the same job (transactions, audit, errors, data loading) instead of adding a second one.
- **Blast radius:** what other code calls what this PR changed? Is that impact stated in the PR brief?
- **Migrations:** safe on a live DB that already has data (defaults for new non-null columns, no destructive change without a data step).
- **Dependencies:** each new one is justified and small. No second library for a job one already does.
- **Names:** match the spec's glossary (taker, giver, period, settlement…).
- **Panel (round 1 of each phase):** you are on every code PR, so you check who else is. Hold the PR body's `Judges:` line against the panel table in `.claude/skills/pr-review-rounds/SKILL.md` section 2, for the files the PR touches (plan round: the files the plan says it will touch). A judge the table asks for is missing → `should-fix` on the first line that needs that judge, with `Fix: add <judge> to the panel` and `Failure: <file> <what it adds or changes> → no <judge> judge reviews it`.
- **Trivial label:** if the builder marked the PR trivial, check it touches no protected area (CLAUDE.md). Disagree → `should-fix` with the protected path in the `Failure:` line.

## In a plan round

PR size is yours, and the plan round is the only time a split is cheap. The plan states how many lines it expects to change, not counting tests, migrations and generated files (soft goal about 400, `CLAUDE.md`).

| The plan expects | And | You |
| --- | --- | --- |
| up to about 800 lines | | say nothing about size |
| more than about 800 | its reason for one PR holds: the parts cannot land one after the other (one fails CI without the other, or the first alone leaves people with a broken or half-working feature) | no finding. Say it in your summary sentence: `About <n> lines in one PR: <the reason>.` |
| more than about 800 | it gives no reason, or the reason does not hold: you can name parts that each pass CI alone and leave nothing half-working for people | `should-fix` on the plan's size line, with the split in `Fix:` (which tasks go in which stacked PR) |
| no size stated | | count the tasks' files yourself, then use the rows above |

The `Failure:` line for a size finding: `Built as written: about <n> changed lines land as one PR → <part A> and <part B> get one review and one brief, though <why each stands alone>`.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether a §5 rule is right | Rules |
| Missing tests, test quality | Tests |
| Authorization, validation | Security |
| Screens | UX |
| Docker, CI | Ops |

**Tie-break with Rules** (when Rules is on the panel), by the contract's first severity question:

- The failure can happen with this PR's code and ends in wrong points, a broken §5 rule or a missing audit entry → Rules'. Leave it out. What stays yours is a shape problem with a `Failure:` line of its own, e.g. "the write lives outside the agreement module → the next caller skips the check".
- The failure is a trap: a shape this PR adds (a key, a type, a signature, a module split) that a later issue will spring → yours, also when a §5 rule is what breaks then. Rules leaves these to you, so nobody else will raise it.

## Common mistakes

- Repeating the Rules judge's spec findings because "the pattern would have prevented it" or "it is really a schema problem". See the tie-break above.
- Proposing refactors of code the PR didn't touch. That is `pre-existing`.
- Performance advice for 5 users. Only a `Failure:` line with real slowness counts.
