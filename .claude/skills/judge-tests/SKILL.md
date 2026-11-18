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
- **Code outside the domain** has edges too:
    - wiring: a new module, hook, plugin or route runs at least once through its real entry point, not only through its inner function;
    - what leaves the server: the returned shape is pinned, so a secret field (password hash, token) can't slip in;
    - switches: an env flag or a setting is tested both on and off;
    - limits: a maximum is tested exactly at the limit and one past it.
- **Fake clock:** fixed instants, no `new Date()` or `Date.now()` in tests.
- **Behaviour, not internals:** tests call the public function and assert results and stored state, not private helpers or mocks of the unit under test.
- **Audit:** at least one test proves the state change rolls back when the audit write fails.
- **Nothing weakened:** no `skip`, `only`, loosened assertions or deleted tests. A deleted test is fine only when the code it covered was deleted with it.
- **E2E:** only when the repo has a Playwright config (`playwright.config.*`): a flow for each user flow the PR adds or changes. No config in the repo → say nothing about E2E, at any severity.

## Prove a gap with a mutant

A missing test is a claim until you show a bug that gets through. For each gap you would file as `should-fix`:

1. `pnpm install --frozen-lockfile` in your checkout if `node_modules` is missing.
2. Break the one line the missing test should guard: drop the check, flip `<` to `<=`, return the unfiltered row, move the write out of the transaction.
3. Run the test files that cover it: `pnpm vitest run <files>`.
4. All pass → the mutant survived, and the gap is real. A test fails → the code is covered: no finding.
5. `git checkout -- <file>` before the next mutant. Leave the checkout clean when you finish.

The `Failure:` line in this lane has this shape:

```
Failure: <file>:<line> <the change you made> → <N> tests pass (<test files>); <what a person or the data would then see>
```

A gap you ran no mutant for is a `nit`.

Gaps that one new test (or one test setup) would close are one finding, placed at the most serious of them, with the other mutants listed in its `Failure:` line.

Start your review's one-sentence summary with the count: `Mutants: <n> run, <k> survived. <most important point>`. Claim "covered" only for lines whose mutant you ran and saw fail; for the rest say "by reading".

## Severity in this lane

Tag by the bug the surviving mutant lets through, as if it had shipped:

| The bug would be | Tag |
| --- | --- |
| wrong points, a state the spec forbids, one person acting as another, a leaked secret, lost data, a state change with no audit entry, a screen or flow that stops working | `should-fix` |
| anything smaller: a trim, a label, a rename, an error message, a second example of a case already tested | `nit` |
| a test this PR skipped, loosened or deleted to get green | `blocker` |

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether the code itself is right | Rules |
| Code structure | Architecture |

A bug you found while reading tests goes to Rules if Rules is on the panel. Your finding is the **missing test** that would have caught it.

## Common mistakes

- Filing a gap from reading alone. Run the mutant; half of the gaps that look open are covered by a test in another file.
- Asking for a coverage percentage. Ask for the specific missing case.
- Asking for tests of code the PR didn't touch. That is `pre-existing`.
- Raising a new `should-fix` each round for a smaller and smaller bug. The table above decides, not the round.
