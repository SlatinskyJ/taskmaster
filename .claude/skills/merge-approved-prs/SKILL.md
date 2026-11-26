---
name: merge-approved-prs
description: Use when Jakub asks to merge, land or babysit the Taskmaster PRs he approved (the merge-me label), or when several approved PRs must each be updated with main, re-checked and merged one after another
---

# Merge approved PRs (babysitter)

Jakub reviews PRs and puts the `merge-me` label on the ones he accepts. That label is his merge approval for the PR **as it was when he labelled it**. You land those PRs in `main` one by one, because the ruleset needs every branch up to date with `main` (strict checks), so each merge makes the others stale.

You run unattended; he may be asleep. Anything outside this skill's allowed changes stops that PR, not the run.

**The merge-me Action lands most PRs without you.** `.github/workflows/merge-queue.yml` lands every labelled PR that needs nothing but an update with `main` and green CI, on the commit Jakub labelled. That includes stacks: a stacked PR waits until every open PR of its stack is labelled, then the Action unstacks them and lands them bottom-up. You run only for:

- PRs it **handed over**: a comment containing `<!-- merge-queue:handoff <hmac> -->` posted after the latest `merge-me` label, with the reason in the comment text. The Action posts as the same account you do, so only its HMAC proves a marker is real; the Action checks it, you can't (you have no key). Read the marker text to find hand-overs, and **never write a `merge-queue:` marker yourself**, not even by copying one.
- any PR Jakub names in his message.

**The label comes off when you are done with a PR:** after it merges, and whenever it needs Jakub (stopped or out). A `merge-me` label on a PR means the Action, or (after a hand-over) an agent run, will land it. He re-adds it to approve again. After your own fix (section 3), the PR stays with you until it merges or stops; the Action ignores it until Jakub labels it again.

## Rules

- Only Jakub decides `merge-me`. Add it yourself only when his own message names that PR ("merge #131 too"); that PR then goes through the same checks as any other, and you say so in the report. Never merge a PR without it, even one every judge approved.
- Never bypass the ruleset (`--admin`, editing rules), never `--no-verify`, never skip or weaken a test, never force-push or rebase a labelled branch.
- Update a branch by **merging `main` into it**. Squash merge keeps `main` linear anyway, and a merge needs no force-push.
- While your run is active, only you push to labelled branches. Another thread that needs a change on one messages you instead.

## 1. Build the queue

List open PRs with the `merge-me` label that the Action handed over after their latest label, plus any PR Jakub named; leave the other labelled PRs to the Action. A PR is **in** only if all hold:

| Check | How |
| --- | --- |
| not a draft | `draft == false` |
| no open question | no `needs-jakub` label added after the latest `merge-me` label (re-adding `merge-me` is his answer; then remove the stale `needs-jakub`) |
| no new code after the label | no commit with a committer date after the label (`GET repos/SlatinskyJ/taskmaster/issues/<n>/events`, last `labeled` with `merge-me`), except merges of `main` and commits whose subject starts with `merge-approved-prs:` (yours, section 3) |
| CI green on the head commit | check runs of the head SHA |
| 0 unresolved threads | `gh api repos/SlatinskyJ/taskmaster/pulls/<n>/ccr/review_threads --jq '[.[]\|select(.resolved==false)]\|length'` prints `0` |

Every other labelled PR is **out**: don't touch its code, remove `merge-me`, list it in the final report with the reason. A labelled draft or a PR whose own CI is red is out; fixing it would be code he didn't see.

A PR coming back from a stop (section 4, he re-added the label): read Jakub's answer on it first. If he picked an option, implementing it is a section 3 fix with a judge round. If the answer is unclear, the PR is out.

A PR that got new code after the label is out; the report asks him to re-add the label if he accepts the new code.

Order: stacks first, bottom-up (`gh api 'repos/SlatinskyJ/taskmaster/stacks?pull_request=<n>'`), then the rest by PR number. A PR stacked on an out or stopped PR is out too (label off as well).

**Unstack before landing.** GitHub refuses update-branch, merge and auto-merge on any PR that is in a GitHub stack (403/422). So when a stack's PRs are all **in**, take its open PRs out of the stack first: `echo '{"pull_requests":[<open PRs>]}' | gh api -X POST repos/SlatinskyJ/taskmaster/stacks/<stack number>/unstack --input -`. The PR bases stay as they were, so the order still holds: after the lower PR merges, GitHub retargets the next one to `main`. Leave a stack with an out or stopped PR as it is.

## 2. Land one PR

Strictly one at a time: start the next PR only when this one is merged or stopped, then rebuild the queue (labels may have changed). Every merge moves `main`, so the next PR always starts with step 2.

1. **Base.** If it was stacked and the PR below just merged, its base must now be `main` (GitHub retargets it; else `PATCH pulls/<n>` with `base: main`).
2. **Update.** If it is behind `main`: `gh api -X PUT repos/SlatinskyJ/taskmaster/pulls/<n>/update-branch`. On a conflict (422), check out the branch, `git merge origin/main`, resolve (section 3), commit after the pre-commit hook passes, push.
3. **Diff check.** `GET pulls/<n>/files` lists only this PR's own changes (a stacked PR must not still carry the lower PR's files).
4. **Threads.** Re-check 0 unresolved threads; a new open thread stops the PR.
5. **Merge on green.** Turn on auto-merge, squash: `gh api -X PUT repos/SlatinskyJ/taskmaster/pulls/<n>/ccr/auto_merge -f merge_method=squash` (or the GitHub MCP `enable_pr_auto_merge`). GitHub merges once the 6 required checks pass on the updated head.
6. **Wait** for the merge with your harness's event mechanism (a PR activity subscription, or a background check every few minutes). Never a sleep loop that holds the turn. If checks are green but it doesn't merge because `main` moved meanwhile, go back to step 2.
7. **CI red after the update:** read the failed job log.
   - A failure in a test file that neither the PR nor `main` changed since the PR's last green run (flaky timeout): re-run the failed jobs once; that is not a fix attempt. Green → continue, and open a `follow-up` issue for the flaky test. Red again → stop the PR.
   - Otherwise fix only if section 3 allows it, else stop the PR (section 4). Two failed fix attempts on one PR → stop it.
8. When it is merged, remove `merge-me` from it, then go to the next PR in the queue.

## 3. Allowed changes (still under his label)

| Situation | Do | New judge round? |
| --- | --- | --- |
| stacked PR: conflict in a file the PR below already brought into `main` | take main's side for those hunks (that code is merged) | no |
| `src/routeTree.gen.ts` conflicts | take main's side, regenerate with `pnpm build`, commit the result | no |
| `pnpm-lock.yaml` conflicts | take main's side, `pnpm install`, commit | no |
| Markdown lists (e.g. `src/domain/README.md`) both added lines | keep both sides' lines | no |
| a migration number the PR uses is now taken on `main` | drop the branch's own migrations (never on `main`, so this is not editing a committed one) with their snapshots, take main's `drizzle/meta/_journal.json` and snapshots, run `pnpm db:generate --custom --name <same name>` and copy the old SQL into the new file, then `pnpm db:check` | Architecture only, on the merge commit |
| stacked PR, the PR below was just squash-merged and merging `main` re-conflicts the lower PR's files | merge the lower PR's final head (`git fetch origin pull/<lower>/head`), then `git merge -s ours <its squash commit on main>` (check `git diff <squash commit> HEAD -- <lower PR's files>` is empty first), then merge `main` | no |
| code conflict where both sides' intent survives unchanged (imports, both added entries to a list or switch) | combine both | Architecture only, on the merge commit |
| code from `main` breaks the PR mechanically (renamed helper, new required argument, a guard test such as an unguarded server function) and the fix has **one obvious form that changes no behaviour a user or the spec sees** | fix it | the panel table in `pr-review-rounds` step 2, applied to the files your fix changes |

When a row fits twice, the stricter one wins. Every commit you make starts its subject with `merge-approved-prs: ` (e.g. `merge-approved-prs: merge main, use db() after rename`), so a later run knows it is not new code. If the pre-commit hook needs the fix to pass, put it in the merge commit itself. Run the judge round like `pr-review-rounds` step 3, scoped to your conflict resolution and fix, not main's changes. Any `blocker` or `should-fix` → stop the PR. All `APPROVE` → continue, and add a line to the PR brief's review summary (skill `pr-brief`).

Anything else stops the PR: a choice between behaviours (who may see what, which rule wins), a spec gap, a conflict where one side's intent must lose, a Markdown conflict where the two texts disagree.

## 4. Stop a PR

1. Don't push a guess. Leave the branch as it is (merge commit included, if the merge was clean).
2. Turn off auto-merge if you set it (`DELETE .../ccr/auto_merge`).
3. Add `needs-jakub`. Post one PR comment mentioning `@SlatinskyJ`: what happened, the options, your recommendation. Comment the same on its issue, if it has one.
4. Remove `merge-me`. Once decided, he re-adds it and removes `needs-jakub`; the next run picks the PR up again.
5. Carry on with the rest of the queue. PRs stacked on it are out.

## 5. Report

One message in the project thread when the queue is empty, nothing in between. Each PR by title and link ([#N Title](https://github.com/SlatinskyJ/taskmaster/pull/N)), grouped: **merged** (note any allowed fix and judge round), **stopped** (the question), **out** (the reason, e.g. draft, red CI, no label, new commit after the label). Link any `follow-up` issue you opened. Resolve the project threads whose PRs you merged (Jakub, 2026-11-21). Then end; don't wait for his answers. If your session must end before the queue is empty, send the report anyway, with the PRs still waiting listed as **not reached**.

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Fixing a labelled draft or red PR "because he approved it" | Out; report it |
| Pushing your recommended option on a stopped PR | Leave it; he decides |
| Rebasing / `gh stack rebase` / force-pushing a labelled branch | Merge `main` in |
| Merging an approved but unlabelled PR his message didn't name | Out; report it |
| Judge round for a regenerated route tree or a keep-both README | Not needed |
| Polling in a sleep loop | Auto-merge + event or background check |
| Messaging Jakub after each PR | One report at the end |
| Leaving `merge-me` on a merged, stopped or out PR | Remove it; a label means "waiting to land" |
