# Judge contract (shared by every judge-* skill)

Every judge follows this file. Your own judge skill only defines your **lane**.

## What you get from the builder

- PR number, branch, base branch, the **phase** (`plan` or `code`) and the **round number** (1 to 5)
- **Panel**: the list of judges on this PR
- Plan phase: the path of the plan file and the issue number
- Code phase: link to the PR brief (artifact)
- The spec: `docs/superpowers/specs/2026-11-16-taskmaster-design.md`
- Round 2+: your own earlier findings, the builder's replies, and the commit SHA you last reviewed

You never get the builder's reasoning. Judge the code, not the intent.

## Two phases

A PR that closes an issue is judged twice: first its plan, then its code. Each phase has its own rounds 1 to 5. The builder's prompt names the phase. No phase in the prompt means `code`.

### Phase `plan`

The branch holds one new file, the implementation plan. No code exists yet. You judge **what will be built if the plan is carried out as written**, inside your lane.

- Read the plan, the issue it closes, the spec sections it names, and the existing code it says it will change or call.
- A finding is something that would be wrong or missing in the built code: a rule with no task, a wrong value, a file in the wrong layer, a missing migration step, a missing check, a missing test. Comment inline on the plan line that decides it. For something missing, comment on the task that should own it.
- Not a finding: how the plan is worded, ordered or formatted; anything the plan leaves to the implementer (a function body, a local name, a helper's shape).
- `Failure:` line: `Built as written: <input or state> → <wrong result>`. The two severity questions are asked about the code the plan describes.
- There is no `pre-existing` in a plan round. A problem in today's code that the plan neither adds nor builds on is left out.
- The review header says `Plan round <N>` where a code review says `Round <N>`. `APPROVE` tells the builder to build it.
- "How you review" below applies with "the plan" in place of "the diff". Round 2+ covers your open findings and the plan's changes since the commit you last reviewed.

### Phase `code`

The plan file is gone from the branch. You judge the code cold, against the spec. Don't look the plan up in the branch history, and don't raise "differs from the plan": the plan was the builder's tool, the spec is the rule.

**Gate, round 1 only.** Run both before you read anything:

```bash
# 1. no plan file in the diff: must print nothing
git diff --name-only origin/<base>...HEAD -- docs/superpowers/plans/
# 2. each judge's last plan-round verdict: at least one line, every line APPROVE
gh api 'repos/SlatinskyJ/taskmaster/pulls/<n>/reviews?per_page=100' --jq '[.[].body|select(test("^\\[Judge: \\w+\\] Plan round"))|capture("^\\[Judge: (?<j>\\w+)\\] Plan round (?<r>\\d) — (?<v>\\w+)")]|group_by(.j)|map(max_by(.r))|.[]|"\(.j) \(.v)"'
```

A judge that joined the panel only for the code phase has no line in check 2; that is fine. Check 2 is skipped when the PR body says `Plan: none (ad-hoc)` or `Plan: none (Dependabot)` and has no `Closes #` line.

A check fails → post nothing and review nothing. Return `<Name> round 1: NOT STARTED, plan file still on the branch` or `<Name> round 1: NOT STARTED, no approved plan`.

## How you review

1. Check out the PR branch. Read the diff against the base. Read any other file you need to judge impact and blast radius.
2. **Round 1:** review the whole diff, inside your lane.
3. **Round 2+:** review only (a) whether each of your open findings is fixed, and (b) the diff since the commit you last reviewed. Nothing else.
4. **Caused by this PR:** a finding must come from lines this PR adds or changes, or from existing code that this PR now breaks or misuses. Anything else is `pre-existing`.
5. **Lane:** a problem in another judge's lane goes to that judge. If that judge is on the panel, leave it out. If not, include it and tag it `(lane: <judge>)`.
6. **Answered findings:** if the builder answered "won't fix" with a reason, raise it again only with new evidence (a new failure scenario, or new code). Without new evidence, either accept the answer, or reply on the thread with `escalate` and one sentence on why.
7. **Nobody becomes inactive (Jakub, 2026-11-17):** the app is not designed for a person being deactivated or reactivated part-way through something. A finding whose `Failure:` line needs that to happen (a reservation held by a deactivated taker, an approval left by someone who went inactive, a missing test with an inactive person) is not raised, at any severity. Existing `active` checks stay; new code needs none. One thing is still checked: a deactivated account cannot log in or keep a session (Security).

## Severity

| Tag | Use when | Needs `Failure:` line |
| --- | --- | --- |
| `blocker` | Wrong points or broken spec rule, security hole, data loss, broken build | yes |
| `should-fix` | Real defect or maintainability trap this PR introduces | yes |
| `nit` | Taste, naming, polish | no |
| `pre-existing` | Problem not caused by this PR | no |

A finding you can't write a concrete `Failure:` line for is a `nit`.

Two questions set the tag, in this order:

1. **Can it happen with the code as it is after this PR?** Yes, when functions or endpoints that exist produce the wrong result on a state the schema allows, even if no screen reaches that state yet. No, when it needs code that does not exist yet (a later issue's feature, or a future caller that skips a check): that is a **trap**. A function nothing calls yet still counts as "now" when it returns a wrong result for a call its own contract allows.
2. **Where does the `Failure:` line end?** For a failure that can happen now: wrong points, a state the spec forbids, one person acting as another, lost data or a broken build → `blocker`, however small the fix. Anything else → `should-fix`.

A trap is never a `blocker`. It is a `should-fix` when fixing it later costs more than fixing it now (a migration, stored data to repair, a signature every caller will use), and its `Failure:` line names the issue that springs it. Otherwise it is a `nit`.

## Output: exactly this shape

Post one GitHub review (event `COMMENT`; the account can't approve or request changes on its own PR) using the GitHub MCP tools: `pull_request_review_write` method `create`, then `add_comment_to_pending_review` per finding, then `pull_request_review_write` method `submit_pending`.

**Review body:**

```
[Judge: <Name>] <Round | Plan round> <N> — <APPROVE | CHANGES>
Blockers <n> · Should-fix <n> · Nits <n> · Pre-existing <n>
<One sentence: the most important point, or "No issues in my lane.">

---
_Generated by [Claude Code](https://claude.ai/code)_
```

`APPROVE` = you have zero open `blocker` or `should-fix` findings. Otherwise `CHANGES`.

**Each inline comment** (on the exact file and line):

```
[Judge: <Name>] `<severity>` — <one-line claim>
Failure: <input or state> → <wrong result>
Spec: §<x.y>
Fix: <one line>

---
_Generated by [Claude Code](https://claude.ai/code)_
```

- `Failure:` only for blocker and should-fix. `Spec:` only when a spec rule applies. `Fix:` is optional.
- One finding per comment. Each finding appears once: inline, not repeated in the review body.
- `nit` and `pre-existing`: the first line only.
- Round 2+, on your own old thread: reply `Fixed in <sha>`, `Accepted`, or `Still open: <new evidence>`.
- After `Fixed in <sha>` or `Accepted`, **resolve the thread** (`gh api -X POST repos/SlatinskyJ/taskmaster/pulls/<n>/ccr/comments/<first comment id>/resolve`). The ruleset blocks merge while any thread is open. Leave it open only with `Still open`.
- A thread the builder already resolved (a `nit` taken or skipped): leave it resolved. Reply on it only when a fix the builder claims is wrong.

## What you return to the builder

One line per judge: `<Name> <plan round | round> <N>: <APPROVE|CHANGES>, <review URL>`.
