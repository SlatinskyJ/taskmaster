# Email Jakub when main goes red: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax.

**Goal:** When the `CI` workflow fails on `main`, email Jakub "Taskmaster: main is broken". When the next run passes, email him "main is green again".

**Issue:** [#338 Alert Jakub when main goes red](https://github.com/SlatinskyJ/taskmaster/issues/338). There is no spec section: this is CI tooling. Jakub chose it in the project thread on 2026-11-27: email, no GitHub issue (report: project files `ci-red-main/2026-11-27-why-main-went-red.md`).

**Architecture:** A new workflow `.github/workflows/red-main.yml` runs on `workflow_run: CI completed` for push runs on `main`. It checks out `main`, with no PR code, and runs `node scripts/red-main/run.ts`. The script reads the triggering run and the recent completed push runs on `main`, decides, and writes `mail.txt` plus the step output `send=true`. A second step sends `mail.txt` with `curl` over SMTPS: curl is on the runner, so there is no new dependency and no third-party action. The script has the same shape as `scripts/merge-queue/`: a pure decision module plus a thin REST layer over `fetch`.

**Size:** about 150 lines, not counting tests. `decide.ts` about 55, `github.ts` about 45, `run.ts` about 25, the workflow about 35, plus 1 CLAUDE.md line and 1 `ci.yml` comment. One PR.

**Tech Stack:** Node 22 type-stripped TS (like `scripts/merge-queue/*.ts`), vitest, GitHub REST, curl SMTP.

## Global Constraints

- Secrets: Jakub adds them, and agents never read them. `ALERT_SMTP_URL` (e.g. `smtps://smtp.gmail.com:465`), `ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD` (an app password) and `ALERT_EMAIL_TO`. No address, host or user goes in the repo, which is public. Until all four are set, the job logs `red-main: secrets not set, nothing to send` and stays green, the same pattern as `merge-queue.yml`'s guard.
- Token: the workflow `GITHUB_TOKEN`, with `permissions: { actions: read }` on the job and `permissions: {}` at the top. It reads runs and jobs only, and writes nothing to GitHub.
- Never check out or run PR code: `actions/checkout` with `ref: main` and `persist-credentials: false`. Pin `checkout` and `setup-node` to the same SHAs as `merge-queue.yml`.
- No new dependency. No change to the required checks or the merge-me Action. `ci.yml` gets one comment edit only.
- Email text in English, plain text, UTF-8.

## Review Focus

1. **Out of order.** Run A (red) finishes after a newer run B (green). A must not send "broken". Rule: skip when a completed push run on `main` with a higher `run_number` exists. No concurrency group, so no waiting run is ever dropped. Test in Task 1 (decide) and Task 2 (the runs query).
2. **A streak of reds.** Each red run sends one email. That is wanted: each email names its commit and failed jobs. "Green again" goes only on the first green after a red. Test in Task 1.
3. **Neither red nor green.** `cancelled`, `skipped`, `neutral`, `action_required` and `stale` send nothing, and "the previous run" means the previous red or green push run, skipping those. `failure`, `timed_out` and `startup_failure` count as red. Test in Task 1.
4. **The SMTP send fails** (wrong password, host down). The send step fails and the job goes red, so GitHub's own failed-workflow notice still goes out. curl gets `--max-time 30`, and the password never reaches the log. Workflow, Task 3.
5. **Header injection.** The subject and body take a commit message's first line. CR/LF in it must not add headers: strip `\r` and `\n` from every header value, and cap the subject at 120 characters. Test in Task 1.

---

### Task 1: Decision and message (`scripts/red-main/decide.ts`)

**Files:**
- Create: `scripts/red-main/decide.ts`
- Test: `tests/red-main-decide.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Run { id: number; runNumber: number; attempt: number; headSha: string; title: string; conclusion: string | null; htmlUrl: string }
  export type Mail = { subject: string; text: string }
  export type Action = { kind: 'send'; mail: Mail } | { kind: 'none'; reason: string }
  /** `completed`: recent completed push runs on main, any order, may include `run`. */
  /** `previousAttemptRed`: run.attempt > 1 and that run's attempt (attempt - 1) was red. */
  export function decide(run: Run, completed: Run[], failedJobs: string[], previousAttemptRed: boolean, repoUrl: string): Action
  export function formatMail(from: string, to: string, mail: Mail, date: Date): string  // RFC 5322 text, CRLF line ends
  ```
- Red is `failure | timed_out | startup_failure`, and green is `success`.
- `decide` returns `none` when:
  - any run in `completed` has `runNumber > run.runNumber` (`newer run`),
  - the run is neither red nor green (`not red or green`),
  - or the run is green, `previousAttemptRed` is false, and the previous red-or-green run in `completed` (the highest `runNumber` below it) is not red, or there is none (`still green`). A re-run that turns a red run green (same `run_number`, a higher attempt) therefore sends "green again".
- Otherwise it returns `send`:
  - Red: subject `Taskmaster: main is broken (<short sha>)`, text = the commit title, the commit link `<run.htmlUrl's repo base>/commit/<sha>`, built from `GITHUB_REPOSITORY` and `GITHUB_SERVER_URL` and passed in by `run.ts` (`decide` takes `repoUrl: string` as a fifth parameter), the run link, the failed job names one per line, and "Production was not deployed from this commit."
  - Green: subject `Taskmaster: main is green again (<short sha>)`, text = the commit title and the run link.
- `formatMail` writes `From`, `To`, `Subject`, `Date`, `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8` and `Content-Transfer-Encoding: 8bit`, a blank line, then the text. Header values lose `\r` and `\n`, and the subject is cut to 120 characters. Every line ending in the whole message, the body included, is CRLF (bare `\n` in the body becomes `\r\n`): SMTP needs CRLF, and curl does not convert without `--crlf`.

- [ ] **Step 1:** Write the failing tests:
  - `red with no newer run sends "main is broken" naming sha, run, commit and every failed job`
  - `red after red sends again`
  - `green right after red sends "green again"`
  - `green after green sends nothing, even with an older red further back` (510 red, 511 green, 512 green → none)
  - `green with no earlier run sends nothing`
  - `a re-run green attempt after a red attempt sends "green again"` (512 attempt 2 green, previousAttemptRed true, 511 green)
  - `a re-run green attempt after a green attempt with 511 green sends nothing`
  - `green skips a cancelled run in between: red, cancelled, green sends "green again"`
  - `a newer completed run (run_number + 1) means none; the run itself in the list (same run_number) does not count` (the boundary)
  - `cancelled, skipped, neutral, action_required and stale send nothing` (it.each)
  - `timed_out and startup_failure count as red` (it.each)
  - `formatMail strips CR and LF from the subject and cuts it at 120 characters`
  - `formatMail turns every body line ending into CRLF and leaves no bare LF anywhere`
  - `formatMail uses CRLF and the UTF-8 headers`
- [ ] **Step 2:** `pnpm vitest run tests/red-main-decide.test.ts` fails (no module).
- [ ] **Step 3:** Implement `decide.ts`.
- [ ] **Step 4:** The same command passes.
- [ ] **Step 5:** Commit: `Decide when a finished main CI run sends the red-main email`.

### Task 2: GitHub reads and entry point (`scripts/red-main/github.ts`, `run.ts`)

**Files:**
- Create: `scripts/red-main/github.ts`, `scripts/red-main/run.ts`
- Test: `tests/red-main-run.test.ts`

**Interfaces:**
- Consumes: `decide`, `formatMail`, `Run`, `Action` (Task 1).
- `github.ts` uses REST over `fetch` with base `https://api.github.com`, `Authorization: Bearer $GH_TOKEN`, `X-GitHub-Api-Version: 2022-11-28` and a 15 s `AbortSignal.timeout`:
  - `getRun(id): Promise<Run>` → `GET /repos/{repo}/actions/runs/{id}`
  - `completedRuns(): Promise<Run[]>` → `GET /repos/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=10`. `event=push` matters, because PR runs share the `run_number` counter.
  - Mapping: `id` ← `id`, `runNumber` ← `run_number`, `headSha` ← `head_sha`, `title` ← `display_title`, `attempt` ← `run_attempt`, `conclusion`, `htmlUrl` ← `html_url`.
  - `attemptConclusion(id, attempt): Promise<string | null>` → `GET .../runs/{id}/attempts/{attempt}`; called only for a green run with `attempt > 1`, with `attempt - 1`.
  - `failedJobs(id): Promise<string[]>` → `GET .../runs/{id}/jobs?filter=latest&per_page=100`, the names of red jobs.
  - A non-2xx response throws `Error('GitHub GET <path>: HTTP <status>')`, with no headers and no body.
- Produces: `export async function main(fetchFn: typeof fetch, env: NodeJS.ProcessEnv): Promise<Action>` in `run.ts`. It reads `getRun(RUN_ID)` and `completedRuns()`, reads `failedJobs` only for a red run, and calls `decide`. On `send`, it writes `formatMail(env.ALERT_SMTP_USER, env.ALERT_EMAIL_TO, …)` to `env.MAIL_FILE` and appends `send=true` to `env.GITHUB_OUTPUT`. It logs `red-main: <kind> <reason or subject>`. Run as a script, with the entry guard from `scripts/merge-queue/run.ts`, it calls `main(fetch, process.env)`.
- Order in `main`: first, if `env.RED_MAIN_TEST === 'true'`, write the test mail (`{ subject: 'Taskmaster: red-main test', text: 'Test of the red-main email. Nothing is broken.' }`), set `send=true` and return, with no fetch and no `RUN_ID` needed (a `workflow_dispatch` run has none). Only then: missing `GH_TOKEN` or `RUN_ID` throws `Error('red-main: GH_TOKEN missing')` / `'RUN_ID missing'` before any fetch.

- [ ] **Step 1:** Write failing tests with a fake `fetch`. It matches each call on method, path **and the full query string**, records every call, and fails the test on an unexpected call. Run fixtures use `id` values that differ from `run_number` and are larger than it (`id: 46042649467, run_number: 512`). The jobs fixture mixes `lint` success, `build` failure, `test` timed_out and `mutation` skipped. Temp dirs come from `fs.mkdtemp`.
  - `red run: writes MAIL_FILE whose body lists build and test only, and sets send=true`
  - `green after green: no MAIL_FILE and no send output`
  - `a late red run behind a newer green: none, with the runs list in either order`
  - `the runs query is exactly branch=main&event=push&status=completed&per_page=10`
  - `the jobs call is made only for a red run`
  - `the attempts call is made only for a green run with run_attempt > 1, for attempt - 1`
  - `RED_MAIN_TEST=true with no RUN_ID and no GH_TOKEN: zero fetch calls, MAIL_FILE holds the test mail, send=true`
  - `an HTTP 403 throws with path and status, and the token is not in the message`
  - `running the script file itself (spawn node scripts/red-main/run.ts with no GH_TOKEN) exits non-zero with "GH_TOKEN missing"` (the real entry point, once)
- [ ] **Step 2:** `pnpm vitest run tests/red-main-run.test.ts` fails.
- [ ] **Step 3:** Implement `github.ts` and `run.ts`.
- [ ] **Step 4:** The tests pass. `pnpm typecheck` and `pnpm lint` are clean.
- [ ] **Step 5:** Commit: `Read main's CI runs and write the red-main email`.

### Task 3: Workflow and docs

**Files:**
- Create: `.github/workflows/red-main.yml`
- Modify: `.github/workflows/ci.yml` line 20 comment. It becomes: "The workflow name `CI` is the trigger of merge-queue.yml and red-main.yml (workflow_run); rename all three together."
- Modify: `CLAUDE.md`, the Dev commands "Production deploys itself" line, adding: "A red `main` emails Jakub (workflow `red-main`), and so does the next green run."

Workflow shape:
```yaml
name: red-main
# Emails Jakub when CI fails on main, and once when it is green again (#338).
# Runs main's own copy of this file and script; never PR code. No concurrency group: a dropped
# waiting run would be a lost email.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      test:
        description: Send one test email
        type: boolean
        default: false
permissions: {}
jobs:
  alert:
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_branch == 'main') ||
      (github.event_name == 'workflow_dispatch' && github.actor == 'SlatinskyJ')
    runs-on: ubuntu-24.04
    timeout-minutes: 3
    permissions: { actions: read }
    steps:
      - guard step: all four ALERT_* secrets set? -> ready=true, else log "secrets not set, nothing to send"
      - checkout (pinned SHA as in merge-queue.yml), ref: main, persist-credentials: false   [if ready]
      - setup-node (pinned SHA), node-version-file: .nvmrc                                    [if ready]
      - id: decide; run: node scripts/red-main/run.ts                                           [if ready]
        env: { GH_TOKEN: ${{ github.token }}, RUN_ID: ${{ github.event.workflow_run.id }}, RED_MAIN_TEST: ${{ github.event_name == 'workflow_dispatch' && inputs.test }}, MAIL_FILE: ${{ runner.temp }}/mail.txt, ALERT_SMTP_USER, ALERT_EMAIL_TO from secrets }
      - name: Send the email                                                                     [if steps.decide.outputs.send == 'true']
        env: { ALERT_SMTP_URL, ALERT_SMTP_USER, ALERT_SMTP_PASSWORD, ALERT_EMAIL_TO from secrets, MAIL_FILE }
        run: |
          printf 'machine %s login %s password %s\n' "$(echo "$ALERT_SMTP_URL" | sed -E 's#^[a-z]+://([^:/]+).*#\1#')" "$ALERT_SMTP_USER" "$ALERT_SMTP_PASSWORD" > "$RUNNER_TEMP/netrc"
          curl --fail --silent --show-error --max-time 30 --ssl-reqd --url "$ALERT_SMTP_URL" \
            --netrc-file "$RUNNER_TEMP/netrc" --mail-from "$ALERT_SMTP_USER" --mail-rcpt "$ALERT_EMAIL_TO" \
            --upload-file "$MAIL_FILE"
```
A netrc file keeps the password off curl's command line.

- [ ] **Step 1:** Write the workflow, the `ci.yml` comment and the CLAUDE.md line.
- [ ] **Step 2:** `pnpm format:check` and `pnpm lint` are clean. Run `actionlint` if it is installed; otherwise check the file against `merge-queue.yml` by eye.
- [ ] **Step 3:** Commit: `Email Jakub after a red CI run on main`.
- [ ] **Step 4:** Live check after the merge and after Jakub adds the secrets (in the brief): the next green `main` run shows `red-main / alert` green, and its log says `red-main: none still green`. Jakub tests the send path by hand: Actions → red-main → Run workflow with `test` on. That sends one email with the subject `Taskmaster: red-main test`.

## Out of scope

- Holding merge-me merges while `main` is red, and re-running a red `main`.
- Burn-in of new e2e files (option 2 in the report; Jakub declined it for now).
