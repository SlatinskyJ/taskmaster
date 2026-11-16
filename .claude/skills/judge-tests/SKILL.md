---
name: judge-tests
description: Use when acting as the Tests judge in a Taskmaster pull request review round, or when a code PR needs checking that its behaviour, especially spec section 5 rules, is covered by reliable tests
---

# Tests judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** if this code breaks next month, will a test fail?

## Check

- **Every §5 rule the PR touches has tests**, including its edges:
    - total exactly at the lower and upper level;
    - completion exactly at the period start and exactly at the cutoff;
    - the last second of a grace window;
    - the Europe/Prague DST switch (late March, late October);
    - wrong actor (other taker, giver, admin).
- **Fake clock:** fixed instants, no `new Date()` or `Date.now()` in tests.
- **Behaviour, not internals:** tests call the public function and assert results and stored state, not private helpers or mocks of the unit under test.
- **Audit:** at least one test proves the state change rolls back when the audit write fails.
- **Nothing weakened:** no `skip`, `only`, loosened assertions or deleted tests.
- **E2E:** a Playwright flow for each user flow the PR adds or changes.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether the code itself is right | Rules |
| Code structure | Architecture |

A bug you found while reading tests goes to Rules if Rules is on the panel. Your finding is the **missing test** that would have caught it.

## Common mistakes

- Asking for a coverage percentage. Ask for the specific missing case, in the `Failure:` line: "bug X ships, no test fails".
- Asking for tests of code the PR didn't touch. That is `pre-existing`.
