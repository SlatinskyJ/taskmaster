---
name: pr-review-rounds
description: Use when a Taskmaster implementation plan or pull request is ready for its judges, when judge comments arrive on your PR, or when deciding whether a plan can be built, a PR can merge, needs another round, or needs Jakub
---

# PR review rounds (builder side)

You opened the PR, so you run its review. Judges are fresh subagents, each loading one `judge-*` skill. You reply to them, fix, and decide when to stop. Jakub merges; you don't, unless the PR is trivial.

A PR that closes an issue goes through **two phases** in the same PR. Each phase has its own rounds 1 to 5.

| | Plan phase | Code phase |
| --- | --- | --- |
| The branch holds | the plan file, no code | the code; the plan file is deleted |
| The PR is | a draft | ready for review |
| Judges review | the plan | the diff, never the plan |
| Counter in the PR body | `Plan round: N/5` | `Review round: N/5` |
| Ends with | you build the plan (section 5) | Jakub merges (section 6) |

Sections 2, 3, 4 and 7 are the same in both phases. A PR with no issue (ad-hoc) and a Dependabot PR have only the code phase; their PR body says `Plan: none (ad-hoc)` or `Plan: none (Dependabot)`.

## 1. Before round 1

**Plan phase**

- The plan (skill `superpowers:writing-plans`) is the only change on the branch: `docs/superpowers/plans/<date>-<branch name>.md`. Its header names the issue and the spec sections it implements.
- The plan states its size: the lines it expects to change, not counting tests, migrations and generated files. Over about 400, it also says why this is one PR and not a stack.
- **Tests pre-flight.** The Tests judge asks for these on every PR, so the plan has a test step for each one that applies:
    - each state change rolls back when the audit write fails;
    - each level, limit, cutoff and window is tested exactly at its boundary;
    - each action is tried by a wrong actor;
    - each new module, hook, plugin or route runs once through its real entry point;
    - whatever a server function returns has its shape pinned (no secret fields).
- **UX pre-flight** (plans that touch screens). The UX judge asks for these on every screen, so the plan has a step for each one that applies:
    - everything a finger taps is at least 44 px high and wide (`min-h-tap`, `size-tap`);
    - every animation and transition has a `motion-reduce:` opt-out;
    - every request shows a busy state, and when it fails a Czech message and a way to try again;
    - every loader has its empty state and its error state;
    - an action that cannot be undone asks first (Dialog);
    - every row is laid out for a long Czech task name at 360 px: the plan says what wraps, what is cut and what stays whole.
- The PR is a draft. Its body has `Closes #<issue>`, `Plan: <path>` and `Plan round: 0/5`.

**Code phase**

- Every task of the approved plan is done (skill `superpowers:executing-plans`), and CI is green (lint, typecheck, unit tests, build, migration check).
- The plan file is deleted, in a commit of its own, now and not earlier:

    ```bash
    git rm docs/superpowers/plans/<file> && git commit -m "Remove the implementation plan"
    git diff --name-only origin/<base>...HEAD -- docs/superpowers/plans/   # must print nothing
    ```

    The PR body line becomes `Plan: removed in <sha>`. To read the plan again later: `git show <sha>~1:<path>`.
- The PR brief exists (skill `pr-brief`) and its link is at the top of the PR body. Every ruling you made while building (a place where you left the plan) is in the brief.
- The PR body has the line `Review round: 0/5`.
- **Screenshots for the UX judge** (UX on the panel). The UX judge does not run the app; it judges your screenshots. Take them in the same Playwright run as the brief's (skill `pr-brief`), with the viewport 360 px wide, light theme:
    - one for every screen and every state this PR adds or changes: each kind of row, each set of buttons on a row, each form and dialog, each empty and error state;
    - logged in as the role that sees it, on the demo data (`TASKMASTER_ENV=preview`);
    - a long Czech task name (about 30 letters, like "Vyluxovat celý obývák a chodbu") in every row that shows one;
    - named `<screen>-<role>-<state>.png`, in one folder outside the repo.

    Look at each one before round 1. Whatever a person needs to read or tap is whole. Retake the ones a fix changes before the next round. An ad-hoc PR with screens has no plan, so also go through the UX pre-flight list above.
- The `preview` label is set if the PR changes something a user sees (screens, flows, styles, Czech text) and off otherwise (`CLAUDE.md`, PR flow step 4). With the label, the brief links the preview.
- Mark the PR ready for review.

## 2. Pick the panel

| PR touches (plan phase: the plan says it will touch) | Judges |
| --- | --- |
| any code | Architecture, Tests |
| `src/domain/`, DB schema, migrations, server functions for tasks/points/periods | + Rules |
| auth, sessions, passkeys, server functions, dependencies, Docker, CI | + Security |
| screens, components, styles, Czech strings | + UX |
| Dockerfile, CI workflows, what runs when the server starts (`src/server/plugins/`, the migration runner), the preview host files (`deploy/preview/`, `docs/runbooks/`), backup or deploy config, a new native dependency (it compiles or ships a binary, like `better-sqlite3`) | + Ops |
| only docs or comments | none: skip to section 6 |

Write the panel into the PR body: `Judges: Rules, Architecture, Tests`. If the code ends up touching more than the plan said, the code phase panel grows to match. The Architecture judge checks the panel against this table; when it asks for a missing judge, add that judge and run it in the next round with `first review` in place of the round-2 line, so it reads the whole diff.

## 3. Run a round

Bump the phase's counter in the PR body (`Plan round: N/5` or `Review round: N/5`). Make a fresh, empty folder outside the repo for this round (`<scratch>/judges-pr<n>-<phase>-r<N>/`). Spawn one subagent per judge, all at once (Agent tool). Model and effort per judge, from a dry-run test against real reviews (2026-11-21):

| Judge | Plan rounds | Code rounds |
| --- | --- | --- |
| Ops | Sonnet, medium | Sonnet, medium |
| Security | Sonnet, medium | Opus, medium |
| Rules, Architecture, Tests, UX | Opus, medium | Opus, medium |

The same in round 2 and later: a smaller model or a lower effort missed the regressions a fix brings in. Change this table only when Jakub says so.

Each prompt holds only:

```
Load the skill judge-<name> and follow it.
PR #<n>, branch <branch>, base <base>.
Phase: <plan | code>, round <N>.
Panel: <judges>.
[Plan phase] Plan: <path of the plan file>. Issue: #<issue>.
[Code phase] PR brief: <artifact URL>.
[Code phase, UX judge only] Screenshots: <folder>.
[Round 2+] Your open findings and my replies: <links to your threads>. Last commit you reviewed: <sha>.
[Judge added after round 1] First review: review the whole diff.
Findings file: <folder>/<judge>.json
```

Never add your own reasoning, worries or explanations. Judges must read the plan or the code cold. In the code phase a judge gets no plan: not the file, not its path, not "as the plan says".

**Post once, after the last judge.** Judges post nothing to GitHub; each writes its findings file. Wait until every judge you spawned this round has returned. Then run, once:

```bash
node scripts/post-judge-review.ts --dir <folder> --pr <n> --panel <the judges of this round, comma-separated>
```

It posts every finding as one review (one REST create call), then the judges' thread replies and resolves, and prints the review URL. It posts nothing when a judge's file is missing or bad, a file names a judge not in `--panel`, or a judge reviewed a commit that is not the PR head. Then rerun only that judge into the same folder (after a push: every judge of the round, into a new folder), and run the script again. Never post a partial round and never post findings by hand. A rerun after a failed reply call is safe: `posted.json` in the folder records what already went out.

While judges run, push nothing and change nothing in the checkout they read.

A judge that returns `NOT STARTED` hit the gate in the judge contract: a plan file is still on the branch, or the PR has no approved plan. It wrote no file, so the script posts nothing. Fix that first. The round did not count.

## 4. Answer every thread

| Finding | Your action | Thread |
| --- | --- | --- |
| `blocker` / `should-fix` you agree with | fix (plan phase: change the plan), push, reply `Fixed in <sha>` | the judge resolves it next round (its reply goes out through the script) |
| `blocker` / `should-fix` you disagree with | reply `Won't fix: <reason>` | stays open for the judge |
| `nit` | take it or reply `Skipped` | you resolve |
| `pre-existing` | open a GitHub issue labelled `follow-up`, reply with its link | you resolve |
| raised in round 2+ on code unchanged since round 1 (outside the round's scope) | reply `Out of round scope (judge contract, rule 3)`; if the problem is real, open a `follow-up` issue and link it | you resolve |
| judge marked `escalate` | go to section 7 | open |

A judge re-raising an answered point without new evidence: reply `Answered in round <k>; no new evidence (judge contract, rule 6)`. If the fix is small and clearly right, just do it instead of arguing.

Next round only when some `blocker` or `should-fix` thread is still open, or you pushed fixes. Only the judges with open findings run again. Don't message Jakub between rounds.

## 5. Exit of the plan phase

**Plan approved** = every judge on the panel last said `APPROVE`, and **zero unresolved threads** (the command in section 6 prints `0`).

Then:
- Update the PR body line: `Plan round: N/5 · all judges APPROVE · 0 open threads`.
- Build the plan (`CLAUDE.md`, PR flow step 3). Don't wait for Jakub and don't message him: the judges' approval is the go-ahead.
- Until then, the branch gets no code. Not scaffolding, not a migration, not "the easy part".

## 6. Exit of the code phase

**Done** = CI green, every judge on the panel last said `APPROVE`, and **zero unresolved threads**. Check, don't assume:

```bash
gh api repos/SlatinskyJ/taskmaster/pulls/<n>/ccr/review_threads --jq '[.[]|select(.resolved==false)]|length'
```

Must print `0`. A thread whose last reply is the judge's `Fixed in …` / `Accepted` but still open (the resolve call failed, or the judge left out `resolve: true`): resolve it yourself (`POST .../pulls/<n>/ccr/comments/<first comment id>/resolve`). Never tell Jakub a PR is ready while this is above 0.

Then:
- Update the PR brief's review summary (rounds used, fixed, deferred issue links).
- Update the PR body: tick every `## Checklist` box that is now true (`- [x]`), append `· all judges APPROVE · 0 open threads` to the `Review round` line, and replace any `Needs Jakub` section with his decision once he gives it. An unticked box is a claim that the item is not done; leave one unticked only if it is false, and say why on that line.
- **Trivial PR** (no protected area touched, see `CLAUDE.md`, and the Architecture judge didn't object): merge it (squash) and tell Jakub afterwards in one line.
- **Anything else:** tell Jakub it is ready, with the brief link. He merges.

## 7. Escalate to Jakub

Escalate when any of these is true:
- a thread is marked `escalate`, or the same point is still disputed after 2 rounds;
- the spec is wrong, unclear or silent on something the PR needs;
- you're unsure whether the PR is trivial;
- round 5 of a phase ends with an open `blocker` or `should-fix`.

How: add the label `needs-jakub` to the PR, post one PR comment that mentions `@SlatinskyJ` with the question and the options, and send the same question in the project thread. Then wait. Never start round 6 on your own.

## 8. After another PR merges

`main` must be up to date before merge. Update your branch (rebase or the GitHub "update branch" action), let CI run again. Run a new judge round only if the update changed this PR's own code.

## Stacked PRs

- Each PR in the stack has its own plan and runs its own plan rounds and review rounds on its own diff.
- A split the Architecture judge asks for in a plan round: this PR keeps the bottom part. Cut the plan down to it and carry on in the same plan rounds. Each part above gets its own PR and its own plan once the part below it is built.
- Stacked PRs are linked as a GitHub stack (see CLAUDE.md, PR flow step 1).
- Jakub merges bottom-up, or several PRs of the stack at once. GitHub rebases the PRs above onto `main` after a merge; check that each one's base is now `main` and its CI is green (section 8).
- A fix in a lower PR → rebase the PRs above it (`gh stack rebase` or "Rebase stack" in the merge box).

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Writing code while the plan rounds are open | No code before section 5 |
| Deleting the plan once it is approved | It stays on the branch until the build is done (section 1, code phase) |
| Building from what you remember of the plan | Reread the plan file and the ledger, above all after a compaction |
| Telling a code-phase judge what the plan said | Judges read the code cold |
| Posting while a judge still runs, or a judge posting itself | Wait for every judge, then one `post-judge-review.ts` run |
| Committing or pushing while judges run | Wait; a judge's `commit` must be the PR head |
| Screenshots only of the screens that look good, or with short task names | Every changed screen and state, at 360 px, with a long task name |
| Fixing `pre-existing` findings inside the PR | Issue + link |
| Pinging Jakub after each round | Only at exit or escalation |
| Merging a non-trivial PR because all judges approved | Jakub merges |
| Weakening or skipping a test to get green | Never. Fix the code, or escalate |
| Fixing the spec inside the PR | Stop and escalate |
