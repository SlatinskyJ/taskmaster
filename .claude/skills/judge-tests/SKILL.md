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

A missing test is a claim until a mutant shows a bug that gets through. In a code round, CI mutates the `src/` files the PR changes (job `mutation`, StrykerJS). Read its report; do not edit code or run mutants yourself.

1. Find the job for the PR head: `gh api "repos/SlatinskyJ/taskmaster/commits/<head sha>/check-runs?check_name=mutation" --jq '.check_runs[0] | .id, .status, .conclusion'`. Still running → wait and check again (it can take up to 45 min). Failed or missing → say so in the summary; every gap is then by reading, so a `nit`.
2. Read the report: `gh api repos/SlatinskyJ/taskmaster/actions/jobs/<id>/logs`, the lines between `=== mutation report ===` and `=== end mutation report ===`. Each line is `<file>:<line>:<column> <mutator>: <original> → <replacement>`; `(no test)` means no test runs that line at all.
3. Each survivor on a line the PR changed is a gap candidate. Drop equivalent mutants (the change can't alter behaviour, e.g. the text of a log or error message nobody asserts). A survivor on a line the PR did not change is `pre-existing`.
4. A killed mutant means the line is covered: no finding.

The `Failure:` line in this lane has this shape:

```
Failure: <file>:<line> <mutator>: <original> → <replacement> survives (mutation job <job id>); <what a person or the data would then see>
```

A gap no mutant in the report shows is a `nit`.

Gaps that one new test (or one test setup) would close are one finding, placed at the most serious of them, with the other mutants listed in its `Failure:` line.

Start your review's one-sentence summary with the count: `Mutants: <n> in report, <k> survive on changed lines. <most important point>`. Claim "covered" only for lines whose mutants the report shows killed; for the rest say "by reading".

## In a plan round

No code exists, so no mutant can be run. The plan writes its tests out, so use a **paper mutant** instead: name one wrong implementation that the plan's wording allows (a missing filter, a flipped bound, the wrong function behind a button), then read the plan's test steps and the existing tests that will still run. No test would fail → the gap is real.

```
Failure: Built as written: <the wrong implementation> → no planned test fails (<the tests you read>); <what a person or the data would then see>
```

A gap you named no paper mutant for is a `nit`. Tag the others with the table below. The summary starts `Paper mutants: <n> checked, <k> survive. <most important point>`.

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

- Filing a gap from reading alone. Check the report; half of the gaps that look open are covered by a test in another file.
- Asking for a coverage percentage. Ask for the specific missing case.
- Asking for tests of code the PR didn't touch. That is `pre-existing`.
- Raising a new `should-fix` each round for a smaller and smaller bug. The table above decides, not the round.
