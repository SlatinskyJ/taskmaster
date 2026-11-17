---
name: pr-review-rounds
description: Use when a Taskmaster pull request is ready for review, when judge comments arrive on your PR, or when deciding whether a PR can merge, needs another review round, or needs Jakub
---

# PR review rounds (builder side)

You opened the PR, so you run its review. Judges are fresh subagents, each loading one `judge-*` skill. You reply to them, fix, and decide when to stop. Jakub merges; you don't, unless the PR is trivial.

## 1. Before round 1

- CI is green on the draft PR (lint, typecheck, unit tests, build, migration check).
- The PR brief exists (skill `pr-brief`) and its link is at the top of the PR body.
- The PR body has the line `Review round: 0/5`.
- The `preview` label is set if the PR changes something a user sees (screens, flows, styles, Czech text) and off otherwise (`CLAUDE.md`, PR flow step 3). With the label, the brief links the preview.
- Mark the PR ready for review.

## 2. Pick the panel

| PR touches | Judges |
| --- | --- |
| any code | Architecture, Tests |
| `src/domain/`, DB schema, migrations, server functions for tasks/points/periods | + Rules |
| auth, sessions, passkeys, server functions, dependencies, Docker, CI | + Security |
| screens, components, styles, Czech strings | + UX |
| Dockerfile, CI workflows, migration runner, backup, tunnel config | + Ops |
| only docs or comments | none: skip to step 5 |

Write the panel into the PR body: `Judges: Rules, Architecture, Tests`.

## 3. Run a round

Bump `Review round: N/5` in the PR body. Spawn one subagent per judge, all at once (Agent tool, model Opus, effort medium, until Jakub changes it). Each prompt holds only:

```
Load the skill judge-<name> and follow it.
PR #<n>, branch <branch>, base <base>, round <N>.
Panel: <judges>.
PR brief: <artifact URL>.
[Round 2+] Your open findings and my replies: <links to your threads>. Last commit you reviewed: <sha>.
```

Never add your own reasoning, worries or explanations of the code. Judges must read the code cold.

## 4. Answer every thread

| Finding | Your action | Thread |
| --- | --- | --- |
| `blocker` / `should-fix` you agree with | fix, push, reply `Fixed in <sha>` | judge resolves next round |
| `blocker` / `should-fix` you disagree with | reply `Won't fix: <reason>` | stays open for the judge |
| `nit` | take it or reply `Skipped` | you resolve |
| `pre-existing` | open a GitHub issue labelled `follow-up`, reply with its link | you resolve |
| raised in round 2+ on code unchanged since round 1 (outside the round's scope) | reply `Out of round scope (judge contract, rule 3)`; if the problem is real, open a `follow-up` issue and link it | you resolve |
| judge marked `escalate` | go to step 6 | open |

A judge re-raising an answered point without new evidence: reply `Answered in round <k>; no new evidence (judge contract, rule 6)`. If the fix is small and clearly right, just do it instead of arguing.

Next round only when some `blocker` or `should-fix` thread is still open, or you pushed fixes. Only the judges with open findings run again. Don't message Jakub between rounds.

## 5. Exit

**Done** = CI green, every judge on the panel last said `APPROVE`, and **zero unresolved threads**. Check, don't assume:

```bash
gh api repos/SlatinskyJ/taskmaster/pulls/<n>/ccr/review_threads --jq '[.[]|select(.resolved==false)]|length'
```

Must print `0`. A thread whose last reply is the judge's `Fixed in …` / `Accepted` but still open (judge forgot): resolve it yourself (`POST .../pulls/<n>/ccr/comments/<first comment id>/resolve`). Never tell Jakub a PR is ready while this is above 0.

Then:
- Update the PR brief's review summary (rounds used, fixed, deferred issue links).
- Update the PR body: tick every `## Checklist` box that is now true (`- [x]`), append `· all judges APPROVE · 0 open threads` to the `Review round` line, and replace any `Needs Jakub` section with his decision once he gives it. An unticked box is a claim that the item is not done; leave one unticked only if it is false, and say why on that line.
- **Trivial PR** (no protected area touched, see `CLAUDE.md`, and the Architecture judge didn't object): merge it (squash) and tell Jakub afterwards in one line.
- **Anything else:** tell Jakub it is ready, with the brief link. He merges.

## 6. Escalate to Jakub

Escalate when any of these is true:
- a thread is marked `escalate`, or the same point is still disputed after 2 rounds;
- the spec is wrong, unclear or silent on something the PR needs;
- you're unsure whether the PR is trivial;
- round 5 ends with an open `blocker` or `should-fix`.

How: add the label `needs-jakub` to the PR, post one PR comment that mentions `@SlatinskyJ` with the question and the options, and send the same question in the project thread. Then wait. Never start round 6 on your own.

## 7. After another PR merges

`main` must be up to date before merge. Update your branch (rebase or the GitHub "update branch" action), let CI run again. Run a new judge round only if the update changed this PR's own code.

## Stacked PRs

- Each PR in the stack runs its own rounds on its own diff.
- Stacked PRs are linked as a GitHub stack (see CLAUDE.md, PR flow step 1).
- Jakub merges bottom-up, or several PRs of the stack at once. GitHub rebases the PRs above onto `main` after a merge; check that each one's base is now `main` and its CI is green (step 7).
- A fix in a lower PR → rebase the PRs above it (`gh stack rebase` or "Rebase stack" in the merge box).

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Fixing `pre-existing` findings inside the PR | Issue + link |
| Pinging Jakub after each round | Only at exit or escalation |
| Merging a non-trivial PR because all judges approved | Jakub merges |
| Weakening or skipping a test to get green | Never. Fix the code, or escalate |
| Fixing the spec inside the PR | Stop and escalate |
