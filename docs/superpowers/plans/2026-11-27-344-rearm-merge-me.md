# Re-arm merge-me after a resolvable hand-over: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#344 Re-arm merge-me after a hand-over the agent can resolve](https://github.com/SlatinskyJ/taskmaster/issues/344)

**Goal:** A PR the merge-me Action handed over for a problem that needs no choice by Jakub goes back into the queue without a re-label: by itself after red CI once a newer head is green, or on the owner thread's re-arm request after an allowed fix. At most 3 re-arms per label.

**Architecture:** Hand-over markers get a kind (`ci`, `fix`, `final`) and a count `n`. A new signed `resumed` marker records each re-arm and moves the baseline commit that later commits are checked against. `decide.ts` stays pure: it gets the new facts and returns a new `resume` action. `github.ts` reads the markers and the owner's unsigned re-arm request. No new workflow trigger: a re-arm happens on the next event the workflow already gets (CI done, push to `main`).

**Tech Stack:** Node 22 type-stripped `.ts`, vitest, GitHub REST.

**Spec:** none (CI tooling). The rules are in issue #344 and in `.github/workflows/merge-queue.yml` (#253).

**Size:** about 250 changed lines outside tests (`decide.ts` ~80, `github.ts` ~100, `run.ts` ~30, skill + `CLAUDE.md` ~40). Protected area (CI), so not a small PR.

**Panel:** plan: Architecture, Tests. Code: Architecture, Tests, Security, Ops.

## Global Constraints

- Code, identifiers, comments, commits in English.
- Never checks out or runs PR code (workflow header). No new dependency.
- `MAX_REARMS = 3` per qualifying `merge-me` label event (Jakub, 2026-11-27, "stick to 3").
- Signed markers are written only by the Action. Agents never write `merge-queue:approved`, `merge-queue:handoff` or `merge-queue:resumed`.
- An old-format hand-over marker (`<!-- merge-queue:handoff <hmac> -->`, signed `handoff:<pr>:<label>`) still verifies and counts as kind `final`.

## Design

### Markers (all after the latest qualifying label, signed with `MERGE_MARKER_KEY` like today)

| Marker | Format | Signed text |
| --- | --- | --- |
| hand-over | `<!-- merge-queue:handoff <kind> <n> <redSha or -> <hmac> -->` | `handoff:<pr>:<labelId>:<kind>:<n>:<redSha or ->` |
| resumed | `<!-- merge-queue:resumed <n> <sha> <hmac> -->` | `resumed:<pr>:<labelId>:<n>:<sha>` |
| re-arm request (owner thread, **unsigned**) | `<!-- merge-queue:rearm <headSha> -->` | none; counts only from author `SlatinskyJ`, posted after the latest hand-over |

`n` = number of re-arms so far + 1. `redSha` = the head the Action saw red (kind `ci` only, else `-`).

### Kinds

| Hand-over reason | Kind (while re-arms < 3) |
| --- | --- |
| `CI red` | `ci` |
| `update with main has a conflict`, `merge refused (…)` | `fix` |
| everything else (draft, fork, `needs-jakub`, new commits, lower PR bad, unresolved threads, not recorded) | `final` |
| any reason once re-arms = 3 | `final` (reason gets ` (3 re-arms used, add merge-me again)`) |

### What a handed-over PR does next (decide.ts)

Open hand-over = latest valid hand-over with `n > rearms`.

- `final`: skipped, as today.
- `ci` (parked): `entryCheck` on the strict facts (baseline → head via GitHub update merges only), ignoring `ci === 'red'`. Fails → skipped silently (owner already woken). Passes:
  - head ≠ `redSha` and CI green → `resume`;
  - behind `main` → may be the queue's active PR for an `update` (only when no non-parked landable PR is active);
  - else → `wait` (log `CI red, parked`).
- `ci` or `fix` with a re-arm request whose sha = head, head ≠ `redSha`, `headIsFixed` true, and `entryCheck` passing with `headIsApproved := headIsFixed` (CI may be pending, not red) → `resume`.
- otherwise skipped silently.

After `resume` the PR joins `passing` in the same pass, with `headIsApproved = true`, and is landed like any other. Its next problem is a new hand-over with `n + 1`.

`headIsFixed`: every commit after the baseline up to the head is either an accepted GitHub update (as today) **or** a merge with exactly 2 parents, first parent = previous commit, second parent on `main` (a merge of `main`, conflict resolution included) **or** a non-merge commit whose subject starts `merge-approved-prs: `. The subject check guards against an agent's feature commit slipping in, not against forgery: the owner thread pushes as the same account Jakub's label trusts (same trust as skill section 3 today). Security judge: this is the trust widening to review.

Baseline = `sha` of the latest valid `resumed` marker, else the approved SHA.

## Review Focus

1. A green re-run of the red head (same SHA, newer check run) must not re-arm. Test in Task 2.
2. The 4th hand-over under one label must be `final`, also when its reason is `CI red`; the 3rd must still be `ci`. Test at the boundary in Task 2.
3. A re-arm request from someone other than SlatinskyJ, posted before the open hand-over, or naming a stale head, must not count. Tests in Task 3.
4. A parked red PR that is not behind must not hold the queue: another landable PR still moves. Test in Task 2.
5. `needs-jakub` added after the label blocks both re-arm paths. Test in Task 2.

---

### Task 1: Markers

**Files:**
- Modify: `scripts/merge-queue/github.ts` (`handoffMarker`, new `resumedMarker`, `HANDOFF_RE`, new `RESUMED_RE`, `REARM_RE`)
- Test: `tests/merge-queue-github.test.ts`

**Interfaces:**
- Produces: `export type HandoverKind = 'ci' | 'fix' | 'final'` (in `decide.ts`, imported by `github.ts`); `handoffMarker(key, pr, labelEventId, kind: HandoverKind, n: number, redSha: string | null): string`; `resumedMarker(key, pr, labelEventId, n: number, sha: string): string`.

- [ ] **Step 1: failing tests** in a new `describe('markers')`:
  - `handoffMarker(KEY, 9, 501, 'ci', 1, A)` equals `` `<!-- merge-queue:handoff ci 1 ${A} ${hmac(`handoff:9:501:ci:1:${A}`)} -->` ``; with `'fix', 2, null` the sha field is `-`.
  - `resumedMarker(KEY, 9, 501, 1, H)` equals `` `<!-- merge-queue:resumed 1 ${H} ${hmac(`resumed:9:501:1:${H}`)} -->` ``.
- [ ] **Step 2:** `pnpm test tests/merge-queue-github.test.ts` → FAIL (wrong arity / not exported).
- [ ] **Step 3:** implement. Update every existing `handoffMarker(KEY, 9, X)` call in tests to the new arity only where the test is about the new format; keep one test that builds the old format by hand (Task 3).
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5:** commit `merge-queue: kind and count in hand-over markers, resumed marker`.

### Task 2: Decisions

**Files:**
- Modify: `scripts/merge-queue/decide.ts`
- Test: `tests/merge-queue-decide.test.ts`

**Interfaces:**
- `PrFacts` drops `handedOver`, gains:
  - `handover: { kind: HandoverKind; n: number; redSha: string | null } | null` (the open hand-over);
  - `rearms: number` (valid `resumed` markers under this label);
  - `rearmRequest: string | null` (sha named by the latest valid request after the open hand-over);
  - `headIsFixed: boolean`.
- `headIsApproved` / `updatedByAction` are now measured from the baseline (Task 3).
- `Action` hand-over becomes `{ kind: 'hand-over'; pr; reason; as: HandoverKind; n: number; redSha: string | null }`; new `{ kind: 'resume'; pr: number; n: number; sha: string }`.
- `export const MAX_REARMS = 3`; `export function handoverKind(reason: string, rearms: number): HandoverKind`.

- [ ] **Step 1: failing tests** (`facts()` default gets `handover: null, rearms: 0, rearmRequest: null, headIsFixed: true`):
  - `handoverKind('CI red', 0)` → `'ci'`; `('CI red', 2)` → `'ci'`; `('CI red', 3)` → `'final'`; `('update with main has a conflict', 0)` → `'fix'`; `('draft', 0)` → `'final'`.
  - red CI, no hand-over yet → `[{ kind: 'hand-over', pr: 9, reason: 'CI red', as: 'ci', n: 1, redSha: A }]`.
  - red CI with `rearms: 3` → hand-over `as: 'final'`, `n: 4`, reason `'CI red (3 re-arms used, add merge-me again)'`.
  - parked `ci` (`handover: {kind:'ci', n:1, redSha: A}`), head H ≠ A, CI green → first action `{ kind: 'resume', pr: 9, n: 1, sha: H }`, then `{ kind: 'merge', pr: 9, sha: H }`.
  - parked `ci`, head = `redSha`, CI green (re-run) → no `resume`, no merge.
  - parked `ci`, CI red, `behind: true`, no other PR → `[{ kind: 'update', pr: 9 }]`.
  - parked `ci`, CI red, not behind, plus clean PR 10 → PR 10 merges; PR 9 only `wait`.
  - parked `ci` with `needsJakubAfterLabel: true` and CI green on a newer head → `idle` (no resume).
  - `fix` hand-over, `rearmRequest: H`, head H, `headIsApproved: false`, `headIsFixed: true`, CI pending → `resume` then `wait for CI`.
  - same with `rearmRequest: A` (stale) → `idle`; with `headIsFixed: false` → `idle`; with CI red → `idle`.
  - `final` hand-over with `rearmRequest` = head → `idle`.
- [ ] **Step 2:** `pnpm test tests/merge-queue-decide.test.ts` → FAIL.
- [ ] **Step 3:** implement per the Design section. Active PR choice: `landable.filter(not parked).find(updatedByAction) ?? that[0] ?? a parked landable PR that is behind`.
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5:** commit `merge-queue: park red-CI PRs and re-arm them, cap 2 per label`.

### Task 3: Facts from GitHub

**Files:**
- Modify: `scripts/merge-queue/github.ts` (`factsFor`, `walk`, new `walkFixed`)
- Test: `tests/merge-queue-github.test.ts`

**Interfaces:**
- Consumes: Task 1 regexes and `HandoverKind`, Task 2 `PrFacts`.
- Produces: `walkFixed(pr, baseline, head): Promise<boolean>` (internal).

- [ ] **Step 1: failing tests** (via the existing `factsOf` / `world` helpers):
  - new-format `ci` hand-over after the label → `handover: { kind: 'ci', n: 1, redSha: A }`, `rearms: 0`.
  - old-format hand-over (built by hand: `` `<!-- merge-queue:handoff ${hmac(`handoff:9:${LABEL_ID}`)} -->` ``) → `handover.kind === 'final'`.
  - hand-over n 1 then `resumedMarker(KEY,9,LABEL_ID,1,H)` → `handover: null`, `rearms: 1`, and the walk starts at H (head H → `headIsApproved: true`, `updatedByAction: false`).
  - a `resumed` marker with a bad HMAC or for an earlier label → ignored (`rearms: 0`).
  - `<!-- merge-queue:rearm H -->` by SlatinskyJ after the open hand-over → `rearmRequest: H`; by `somebody` → `null`; posted before the hand-over → `null`; two requests → the later one's sha.
  - `headIsFixed`: commits after baseline = [merge of main by `Claude` (2 parents, second on main)] → `true`; plus a non-merge `merge-approved-prs: fix import` → `true`; plus a non-merge `Add feature` → `false`; a merge whose second parent is not on main → `false`.
  - a handed-over PR with an open `ci`/`fix` hand-over still gets full facts (CI, threads, behind); a `final` one keeps the cheap path.
- [ ] **Step 2:** `pnpm test tests/merge-queue-github.test.ts` → FAIL.
- [ ] **Step 3:** implement. Read comments in order; keep the latest valid hand-over, count valid `resumed` markers, track the latest resumed sha as the baseline. Request regex `/<!-- merge-queue:rearm ([0-9a-f]{40}) -->/`, author `JAKUB`, `created_at` after the open hand-over's comment. Commit subjects: `commit.message` first line (add `message` to `GhCommit`).
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5:** commit `merge-queue: read hand-over kinds, resumes and re-arm requests`.

### Task 4: Run step

**Files:**
- Modify: `scripts/merge-queue/run.ts`
- Test: `tests/merge-queue-run.test.ts`

- [ ] **Step 1: failing tests:**
  - a CI-red hand-over comment starts with `handoffMarker(KEY, 9, 501, 'ci', 1, A)` and its text says the Action will take the PR back itself once a newer head is green, at most 3 times, and that the owner thread adds `needs-jakub` if the red test is the PR's own.
  - a `fix` hand-over text says: fix within skill `merge-approved-prs` section 3, push, then post `<!-- merge-queue:rearm <head sha> -->`.
  - a `final` hand-over text says it needs Jakub.
  - `resume` posts exactly one comment starting with `resumedMarker(KEY, 9, 501, 1, H)`, then merges H in the same run.
  - an update conflict on a parked or normal PR hands over `fix` with the current `n`.
  - `step` returns `handedOver` only for new hand-overs (a resume is not one), so the run ends red only on a hand-over.
- [ ] **Step 2:** `pnpm test tests/merge-queue-run.test.ts` → FAIL.
- [ ] **Step 3:** implement (`handOverBody(key, pr, reason, as, n, redSha)`, `resume` case, update-conflict and refused-merge hand-overs use `handoverKind`).
- [ ] **Step 4:** `pnpm test tests/merge-queue-*.test.ts`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5:** commit `merge-queue: post resume and kind-specific hand-over texts`.

### Task 5: Owner thread rules

**Files:**
- Modify: `.claude/skills/merge-approved-prs/SKILL.md`, `CLAUDE.md` (PR flow step 7), `.github/workflows/merge-queue.yml` (header comment only)

- [ ] **Step 1:** skill, section "Woken by a hand-over on your own PR", by kind:
  - `ci`: read the failed log. A test the PR adds or changes → stop the PR (section 4; `needs-jakub` blocks the automatic re-arm). A flake or a break from `main` you can fix (section 3) → fix, push, post the re-arm request. A failure only `main` can fix → do nothing; the Action takes the PR back.
  - `fix`: fix within section 3 (judge round where the table asks), push, then post one comment `<!-- merge-queue:rearm <head sha> -->` plus one line of what you did. The request is your "ready" (Jakub 2026-11-26). Post it right after the push, so the CI-done event of that push picks it up. If CI had already finished, the next queue event (any CI run or push to `main`) picks it up; push nothing extra just to wake it.
  - `final`: section 4.
  - Replace "the Action ignores it until Jakub labels it again" with the re-arm rules and the cap. Keep "never write a `merge-queue:` marker" but exempt exactly `merge-queue:rearm`.
- [ ] **Step 2:** `CLAUDE.md` step 7, one sentence: the owner thread re-arms a resolvable hand-over with a re-arm request (skill `merge-approved-prs`); the Action re-arms a red-CI one itself; at most 3 per label, then Jakub.
- [ ] **Step 3:** workflow header comment: hand-overs have kinds, re-arms up to 3 per label (no behaviour change in the YAML).
- [ ] **Step 4:** `pnpm format:check` → PASS. Commit `merge-approved-prs: owner thread re-arms resolvable hand-overs`.
