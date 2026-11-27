# Alert Jakub when main goes red: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax.

**Goal:** When the `CI` workflow fails on `main`, open (or comment on) one alert issue assigned to Jakub. When `main` goes green again, close it.

**Issue:** [#338 Alert Jakub when main goes red](https://github.com/SlatinskyJ/taskmaster/issues/338). There is no spec section: this is CI tooling, and Jakub chose it in the project thread on 2026-11-27 (report: project files `ci-red-main/2026-11-27-why-main-went-red.md`).

**Architecture:** A new workflow `.github/workflows/red-main.yml` runs on `workflow_run: CI completed`, gated to `event == 'push'` and `head_branch == 'main'`. It checks out `main`, with no PR code, and runs `node scripts/red-main/run.ts`. That script has one pure decision function, plus a thin REST layer over `fetch` with no dependency, the same shape as `scripts/merge-queue/`.

**Tech Stack:** Node 22 type-stripped TS (like `scripts/merge-queue/*.ts`), vitest, GitHub REST.

## Global Constraints

- Token: the workflow's `GITHUB_TOKEN`, with `permissions: { issues: write, actions: read }` on the job and `permissions: {}` at the top. It must not use `MERGE_TOKEN`: that PAT acts as Jakub, and GitHub never notifies a person about their own actions. An issue that `github-actions[bot]` opens and assigns to `SlatinskyJ` does notify him (mail and the GitHub phone app).
- Never check out or run PR code: `actions/checkout` with `ref: main` and `persist-credentials: false`. Pin actions to the same SHAs as `merge-queue.yml`.
- Labels: `bug` only. Agents create no labels (CLAUDE.md).
- No new dependency. No change to `ci.yml`, the required checks or the merge-me Action.
- Code, comments and issue text in English.

## Review Focus

1. **Out of order.** Run A (red) finishes after a newer run B (green) on a later commit. A must not reopen the alert. Rule: act only when this run's `head_sha` is the current tip of `main`, or no later push run on `main` has completed yet. Simplest form: skip when a CI push run on `main` with a higher `run_number` has already completed. Test in Task 1.
2. **Repeat failures.** Three red runs in a row give one open issue with two comments, not three issues. Test in Task 1.
3. **Neither red nor green.** `cancelled`, `skipped`, `neutral`, `action_required` and `stale` change nothing. `failure`, `timed_out` and `startup_failure` count as red. Test in Task 1.
4. **A look-alike issue.** Only an open issue from `github-actions[bot]` whose body has the marker `<!-- red-main -->` counts. An issue Jakub or an agent opens with that title does not. Test in Task 1.
5. **The API fails.** A REST error makes the job fail, visibly, with the status and path, and never with the token. The workflow failing on red `main` is itself a GitHub notification, so a broken alert is still loud. Test in Task 2.

---

### Task 1: Decision (`scripts/red-main/decide.ts`)

**Files:**
- Create: `scripts/red-main/decide.ts`
- Test: `tests/red-main-decide.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MARKER = '<!-- red-main -->'
  export const BOT = 'github-actions[bot]'
  export interface Run { id: number; runNumber: number; headSha: string; conclusion: string | null; htmlUrl: string }
  export interface AlertIssue { number: number; author: string; body: string }
  export type Action =
    | { kind: 'open'; title: string; body: string }
    | { kind: 'comment'; issue: number; body: string }
    | { kind: 'close'; issue: number; body: string }
    | { kind: 'none'; reason: string }
  export function decide(run: Run, newerCompleted: boolean, open: AlertIssue[], failedJobs: string[]): Action
  ```
- Red is `failure | timed_out | startup_failure`, and green is `success`.
- `decide`: if `newerCompleted`, return `none`. The alert is the first entry of `open` with `author === BOT` that has `MARKER` in its body. On red: `comment` if an alert is open, else `open`. On green: `close` if an alert is open, else `none`. Anything else: `none`.
- Title: `main is red`. The open body is: the `MARKER`, a line with the commit short SHA linked to the commit, the run link, a list of the failed job names, and one line saying "This issue closes itself when CI on `main` passes again." The comment body has the same facts, without the marker. The close body is "Green again: <run link> (<short sha>)."

- [ ] **Step 1:** Write the failing tests:
  - `opens an issue when the tip goes red and none is open`
  - `comments, not opens, when an alert is already open`
  - `closes the alert on green`
  - `does nothing on green with no alert`
  - `ignores cancelled, skipped, neutral, action_required and stale` (it.each)
  - `counts timed_out and startup_failure as red`
  - `does nothing when a newer main run already completed`
  - `ignores an open issue with the marker from another author, and one from the bot without it`
  - `the open body lists every failed job and links the run and the commit`

  Each test asserts on the `Action` the function returns.
- [ ] **Step 2:** `pnpm vitest run tests/red-main-decide.test.ts` fails (no module).
- [ ] **Step 3:** Implement `decide.ts`.
- [ ] **Step 4:** The same command passes.
- [ ] **Step 5:** Commit: `Decide what a finished main CI run does to the red-main alert`.

### Task 2: GitHub layer and entry point (`scripts/red-main/github.ts`, `run.ts`)

**Files:**
- Create: `scripts/red-main/github.ts`, `scripts/red-main/run.ts`
- Test: `tests/red-main-run.test.ts`

**Interfaces:**
- Consumes: `decide`, `Run`, `AlertIssue`, `Action` (Task 1).
- Produces: `export async function main(fetchFn: typeof fetch, env: NodeJS.ProcessEnv): Promise<Action>` in `run.ts`. Run as a script, it calls `main(fetch, process.env)` and logs `red-main: <kind> <reason or issue>`.
- `github.ts` uses REST over `fetch` with base `https://api.github.com`, `Authorization: Bearer $GH_TOKEN`, `X-GitHub-Api-Version: 2022-11-28` and a 15 s `AbortSignal.timeout`:
  - `getRun(id)` → `GET /repos/{repo}/actions/runs/{id}`
  - `newerCompleted(run)` → `GET /repos/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=5`, then `some(r => r.run_number > run.runNumber)`
  - `failedJobs(id)` → `GET .../runs/{id}/jobs?filter=latest&per_page=100`, the names where `conclusion` is red
  - `openAlerts()` → `GET /repos/{repo}/issues?state=open&creator=github-actions[bot]&per_page=100` (creator URL-encoded; drop entries that have `pull_request`)
  - `apply(action)`: `open` → `POST /issues` with `{ title, body, labels: ['bug'], assignees: ['SlatinskyJ'] }`. `comment` → `POST /issues/{n}/comments`. `close` → a comment, then `PATCH /issues/{n}` with `{ state: 'closed', state_reason: 'completed' }`.
  - A non-2xx response throws `Error('GitHub <METHOD> <path>: HTTP <status>')`, with no headers and no body.
- Env: `GH_TOKEN`, `GITHUB_REPOSITORY`, `RUN_ID` (the CI run id, from `github.event.workflow_run.id`).

- [ ] **Step 1:** Write failing tests with a fake `fetch` that routes by method and path:
  - `red tip with no alert posts one issue assigned to SlatinskyJ, labelled bug`
  - `green with an alert comments then closes it`
  - `a newer completed run means no writes at all`
  - `an HTTP 403 throws with method, path and status, and the token is not in the message`
  - `the creator query is URL-encoded`
- [ ] **Step 2:** `pnpm vitest run tests/red-main-run.test.ts` fails.
- [ ] **Step 3:** Implement `github.ts` and `run.ts`. Guard the script entry the same way `scripts/merge-queue/run.ts` does.
- [ ] **Step 4:** The tests pass. `pnpm typecheck` and `pnpm lint` are clean.
- [ ] **Step 5:** Commit: `Open, comment on and close the red-main alert through the REST API`.

### Task 3: Workflow and docs

**Files:**
- Create: `.github/workflows/red-main.yml`
- Modify: `CLAUDE.md`: one sentence on the Dev commands "Production deploys itself" line: "A red `main` opens an issue `main is red` for Jakub (workflow `red-main`); it closes itself on the next green run."

Workflow shape:
```yaml
name: red-main
# A failed CI run on main opens (or comments on) one issue for Jakub; the next green run closes it (#338).
# Runs main's own copy of this file and script; never PR code.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
permissions: {}
concurrency: { group: red-main, cancel-in-progress: false }
jobs:
  alert:
    if: github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main'
    runs-on: ubuntu-24.04
    timeout-minutes: 3
    permissions: { issues: write, actions: read }
    steps:
      - checkout (pinned SHA as in merge-queue.yml), ref: main, persist-credentials: false
      - setup-node (pinned SHA), node-version-file: .nvmrc
      - run: node scripts/red-main/run.ts
        env: { GH_TOKEN: ${{ github.token }}, RUN_ID: ${{ github.event.workflow_run.id }} }
```

- [ ] **Step 1:** Write the workflow and the CLAUDE.md line.
- [ ] **Step 2:** `pnpm format:check` and `pnpm lint` are clean. Run `actionlint` if it is available; otherwise check the YAML parses: `node -e "require('yaml')"`, or check by eye against `merge-queue.yml`.
- [ ] **Step 3:** Commit: `Run the red-main alert after every CI run on main`.
- [ ] **Step 4:** Live check after the merge (in the brief): the next `main` run shows job `red-main / alert` green, and its log says `red-main: none`. The red path can't be forced on `main` safely, so the unit tests cover it, and the first real red run is its live test.

## Out of scope

- Holding merge-me merges while `main` is red, and re-running a red `main`. Ask Jakub separately if wanted.
- Burn-in of new e2e files (option 2 in the report; Jakub declined it for now).
