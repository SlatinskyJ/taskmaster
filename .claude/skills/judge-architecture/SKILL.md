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
- **Trivial label:** if the builder marked the PR trivial, check it touches no protected area (CLAUDE.md). Disagree → `should-fix` with the protected path in the `Failure:` line.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether a §5 rule is right | Rules |
| Missing tests, test quality | Tests |
| Authorization, validation | Security |
| Screens | UX |
| Docker, CI | Ops |

## Common mistakes

- Repeating the Rules judge's spec findings because "the pattern would have prevented it". If Rules is on the panel, leave it out.
- Proposing refactors of code the PR didn't touch. That is `pre-existing`.
- Performance advice for 5 users. Only a `Failure:` line with real slowness counts.
