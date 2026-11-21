# Mutation testing in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#155 Mutation testing in CI for the Tests judge](https://github.com/SlatinskyJ/taskmaster/issues/155)

**Goal:** A non-required PR CI job `mutation` runs StrykerJS on the `src/` files the PR changes and prints the surviving mutants as `file:line`, so the Tests judge reads a report instead of breaking code by hand.

**Architecture:** Stryker (vitest runner, `related` test selection, `perTest` coverage) is configured once in `stryker.config.json`. Two small pure functions in `scripts/mutation/mutation.ts` pick the files to mutate from the PR's file list and turn Stryker's JSON report into a Markdown list of survivors; a thin CLI `scripts/mutation/run.ts` wires them to Stryker, stdout, the job summary and an artifact. The `judge-tests` skill's "Prove a gap with a mutant" section is rewritten to read that report.

**Tech Stack:** `@stryker-mutator/core` 10.1.1, `@stryker-mutator/vitest-runner` 10.1.1 (peer `vitest >=2`, repo has vitest 5), Node 22 type stripping for scripts (same as `scripts/check-migrations.ts`), GitHub Actions.

**Spec:** none: tooling. The spec (`docs/superpowers/specs/2026-11-16-taskmaster-design.md` §11 stack) is not changed. Scope is the issue body, agreed with Jakub in the project thread.

**Size:** about 245 changed lines without tests: config 20, `mutation.ts` 70, `run.ts` 60, CI job 45, skill 30, ignores/CLAUDE.md/package.json 15. Tests about 220. Plus `pnpm-lock.yaml` (generated).

**Judges:** Architecture, Tests, Security (new dependencies, CI), Ops (CI workflow).

## Global Constraints

- Dev dependencies only, pinned exact: `@stryker-mutator/core@10.1.1`, `@stryker-mutator/vitest-runner@10.1.1` (both published 2026-10-23, older than two weeks).
- The job is **not** a required status check; do not touch the ruleset. It never fails because mutants survive (`thresholds.break: null`); it fails only when Stryker itself cannot run (e.g. the initial test run fails).
- Mutated files: added or modified `src/**/*.ts` and `src/**/*.tsx`, except `*.test.ts(x)`, `src/routeTree.gen.ts` and `src/server/db/testing.ts` (test support). Deleted files are never passed.
- No changed mutable file → the job passes and prints `No src/ files to mutate.`; Stryker is not started.
- Read-only workflow token (`contents: read`, `pull-requests: read`). No PR comment, no secrets. Action pins reuse the SHAs already in `ci.yml`.
- English in code, logs and the report. No Czech strings involved.
- Incremental mode: not in this PR (YAGNI; a whole-file run of `src/server/tasks/bidding.ts` takes 23 s locally, `src/domain/settlement.ts` 2 min).

## Review Focus

1. A PR that only deletes or renames away a `src/` file: deleted paths must not reach `--mutate` (a deleted path would mutate nothing and read as "all covered"). Pinned by `mutateTargets` dropping `removed` entries and keeping the new name of a `renamed` one.
2. A PR touching only tests or `src/routeTree.gen.ts`: nothing to mutate → job green, no Stryker start. Pinned in Task 1 and by the `main` test "no targets → Stryker not started" (Task 2 Step 3).
3. A mutant with no test at all (`NoCoverage`): it is as much a gap as `Survived`, so the report lists it, marked `no test`. Pinned in Task 1.
4. A changed `.tsx` route with no related test: every mutant there is `NoCoverage`; the report must stay readable (one line per mutant, capped). Pinned by the 200-line cap test in Task 1.
5. Survivors on lines the PR did not change (Stryker mutates whole files): the report prints them all; the judge skill says these are `pre-existing`. Pinned in the skill text (Task 3), not in code.

---

### Task 1: Pick targets and format the report (pure functions)

**Files:**
- Create: `scripts/mutation/mutation.ts`
- Test: `tests/mutation.test.ts`

**Interfaces:**
- Produces:
  - `type PrFile = { filename: string; status: string }` (the shape of GitHub's `pulls/<n>/files` entries; `status` is `added | modified | removed | renamed | copied | changed | unchanged`).
  - `mutateTargets(files: readonly PrFile[]): string[]`: sorted, unique paths to mutate.
  - `type MutantStatus = 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'CompileError' | 'RuntimeError' | 'Ignored' | 'Pending'`.
  - `type StrykerReport = { files: Record<string, { source: string; mutants: { mutatorName: string; replacement?: string; status: MutantStatus; location: { start: { line: number; column: number }; end: { line: number; column: number } } }[] }> }` (subset of mutation-testing-report-schema; `line` and `column` 1-based, `end` exclusive).
  - `survivorReport(report: StrykerReport, maxLines?: number): { survived: number; noCoverage: number; total: number; markdown: string }`; `maxLines` default 200.

- [ ] **Step 1: Write the failing tests** in `tests/mutation.test.ts`:

```ts
describe('mutateTargets', () => {
  it('keeps added, modified and renamed src .ts/.tsx files, sorted', () => {
    expect(mutateTargets([
      { filename: 'src/b.tsx', status: 'modified' },
      { filename: 'src/a.ts', status: 'added' },
      { filename: 'src/c.ts', status: 'renamed' },
      { filename: 'src/d.ts', status: 'copied' },
      { filename: 'src/e.ts', status: 'changed' },
      { filename: 'src/a.ts', status: 'modified' }, // duplicate → once
    ])).toEqual(['src/a.ts', 'src/b.tsx', 'src/c.ts', 'src/d.ts', 'src/e.ts'])
  })
  it('drops removed files, tests, generated and test-support files, and anything outside src/', () => {
    expect(mutateTargets([
      { filename: 'src/gone.ts', status: 'removed' },
      { filename: 'src/x.test.ts', status: 'modified' },
      { filename: 'src/x.test.tsx', status: 'modified' },
      { filename: 'src/routeTree.gen.ts', status: 'modified' },
      { filename: 'src/server/db/testing.ts', status: 'modified' },
      { filename: 'scripts/a.ts', status: 'modified' },
      { filename: 'tests/a.test.ts', status: 'modified' },
      { filename: 'src/styles/app.css', status: 'modified' },
      { filename: 'docs/src/a.ts', status: 'modified' },
    ])).toEqual([])
  })
})

describe('survivorReport', () => {
  // Fixture shape copied from a real report of the spike (Stryker 10.1.1 json reporter):
  // `location` line and column are both 1-based, `end` is exclusive.
  // files (in this key order): 'src/z.ts' and 'src/a.ts'.
  // src/a.ts source: "const a = 1\nif (x > 0) go()\nlog('hi there')\n"
  //   mutants, listed out of line order:
  //   NoCoverage StringLiteral  start 3:5  end 3:15  replacement '""'       (original 'hi there' with quotes)
  //   Killed     ArithmeticOp   start 1:11 end 1:12
  //   Survived   ConditionalExpression start 2:5 end 2:10 replacement 'true' (original 'x > 0')
  //   Timeout    BlockStatement start 2:12 end 2:16
  // src/z.ts source: "export const z = () => 1\n" with one Survived ArrowFunction start 1:18 end 1:25, replacement '() => undefined'
  it('lists Survived and NoCoverage mutants as file:line:column, sorted by file then line', () => {
    const r = survivorReport(fixture)
    expect(r).toMatchObject({ survived: 2, noCoverage: 1, total: 5 })
    expect(r.markdown.split('\n').filter((l) => l.startsWith('- '))).toEqual([
      "- `src/a.ts:2:5` ConditionalExpression: `x > 0` → `true`",
      "- `src/a.ts:3:5` StringLiteral (no test): `'hi there'` → `\"\"`",
      '- `src/z.ts:1:18` ArrowFunction: `() => 1` → `() => undefined`',
    ])
    expect(r.markdown).not.toMatch(/Killed|Timeout/)
  })
  it('collapses a multi-line original to one line and cuts it at 80 chars with …', () => {
    // mutant spanning "{\n  a()\n}" → original shown as `{ a() }`;
    // mutant over a 100-char string → first 80 chars + '…'
  })
  it('says so when nothing survived', () => {
    expect(survivorReport(allKilled).markdown).toContain('No surviving mutants.')
  })
  it('caps the list at maxLines and says how many were left out', () => {
    const r = survivorReport(fixtureWith(250), 200)
    expect(r.markdown.match(/^- `/gm)).toHaveLength(200)
    expect(r.markdown).toContain('… and 50 more in mutation.json')
  })
})
```

Header line of `markdown`, pinned in the first test: `` `Mutants: <total> total, <survived> survived, <noCoverage> without a test.` ``

- [ ] **Step 2:** `pnpm vitest run tests/mutation.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement both functions in `scripts/mutation/mutation.ts`. No Node imports needed (pure). The original text is `source` sliced by the mutant's `location` (convert line/column to offsets).
- [ ] **Step 4:** `pnpm vitest run tests/mutation.test.ts` → PASS.
- [ ] **Step 5:** Commit `Mutation report: pick targets and list survivors`.

### Task 2: Stryker config, CLI and the CI job

**Files:**
- Modify: `package.json` (devDependencies, script `"mutation": "stryker run"`), `pnpm-lock.yaml`
- Create: `stryker.config.json`, `scripts/mutation/run.ts`
- Modify: `.gitignore`, `.prettierignore`, `.dockerignore`, `eslint.config.js` ignores and `tsconfig.json` `exclude` (`reports`, `.stryker-tmp`): an interrupted run leaves its sandbox (a repo copy + `node_modules` link) that typecheck, lint and `docker build` must not read
- Test: `tests/mutation-run.test.ts`
- Modify: `.github/workflows/ci.yml` (new job `mutation`)
- Modify: `CLAUDE.md` Dev commands (one line)

**Interfaces:**
- Consumes: `mutateTargets`, `survivorReport` (Task 1).
- Produces:
  - `type RunDeps = { spawn: (args: string[]) => { status: number | null }; readFile: (path: string) => string | undefined; writeFile: (path: string, text: string) => void; appendFile: (path: string, text: string) => void; log: (line: string) => void; env: Record<string, string | undefined> }` (`readFile` returns `undefined` when the file is missing).
  - `main(prFiles: readonly PrFile[], deps: RunDeps): number` exported from `scripts/mutation/run.ts`; the file's bottom runs it with real deps (`spawnSync('pnpm', ['exec', 'stryker', 'run', ...args], { stdio: 'inherit' })`, `node:fs`) only when it is the entry module (`import.meta.main`), so tests import it without side effects.
  - CLI `node scripts/mutation/run.ts <pr-files.json>` (JSON array of `PrFile`). Writes `reports/mutation/survivors.md`, prints the Markdown between the lines `=== mutation report ===` and `=== end mutation report ===`, appends it to `$GITHUB_STEP_SUMMARY` when set.
  - Exit code: 0 when nothing to mutate; otherwise Stryker's status when it is non-zero; 1 when the status is `null` (killed) or when Stryker said 0 but `reports/mutation/mutation.json` is missing (log `Stryker finished but wrote no report.`); else 0.

- [ ] **Step 1:** `pnpm add -D -E @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1`.
- [ ] **Step 2:** `stryker.config.json` (values tried in a local spike):

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "vitest": { "configFile": "vitest.config.ts", "related": true },
  "coverageAnalysis": "perTest",
  "ignoreStatic": true,
  "reporters": ["json", "clear-text", "progress"],
  "jsonReporter": { "fileName": "reports/mutation/mutation.json" },
  "tempDirName": ".stryker-tmp",
  "thresholds": { "high": 80, "low": 60, "break": null },
  "timeoutMS": 10000
}
```

`ignoreStatic` skips mutants in module-level constants (e.g. `strings.ts`), which would rerun every test for no finding.

- [ ] **Step 3: Write the failing tests** in `tests/mutation-run.test.ts`, with fake `RunDeps` that record calls:
  - `no targets: Stryker is not started, logs "No src/ files to mutate.", returns 0` (input: only `src/routeTree.gen.ts` modified and `src/a.test.ts`).
  - `passes the targets to Stryker as one --mutate argument`: spawn called once with `['--mutate', 'src/a.ts,src/b.ts']`.
  - `Stryker status 1 → returns 1`; `status null → returns 1`.
  - `status 0 but no mutation.json → returns 1 and logs "Stryker finished but wrote no report."`.
  - `status 0 with a report → returns 0, logs the markers around survivorReport's markdown, writes survivors.md, appends to GITHUB_STEP_SUMMARY when set and not when unset`.
- [ ] **Step 4:** `pnpm vitest run tests/mutation-run.test.ts` → FAIL; implement `main`; → PASS.
- [ ] **Step 5: Manual check** of the real wiring (it runs in CI in Step 9):
  - `echo '[{"filename":"src/routeTree.gen.ts","status":"modified"}]' > /tmp/f.json && node scripts/mutation/run.ts /tmp/f.json` → prints `No src/ files to mutate.`, exit 0.
  - `echo '[{"filename":"src/server/tasks/bidding.ts","status":"modified"}]' > /tmp/f.json && node scripts/mutation/run.ts /tmp/f.json` → Stryker runs (~25 s), the marked block lists survivors as `` `src/server/tasks/bidding.ts:<line>:<col>` ``, exit 0.
- [ ] **Step 6:** CI job in `ci.yml`, after `build`, with a comment that it is deliberately not required:

```yaml
  # Mutation testing (#155) for the Tests judge: mutates the src/ files this PR changes and
  # lists surviving mutants (job log between the "=== mutation report ===" markers, job summary,
  # artifact mutation-report). Not a required check; survivors never fail it.
  mutation:
    name: mutation
    needs: [changes]
    if: github.event_name == 'pull_request' && needs.changes.outputs.code != 'false'
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    permissions:
      contents: read
      pull-requests: read
    steps:
      - *checkout
      - *pnpm
      - *node
      - *install
      - name: List the PR's files
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR}/files?per_page=100" --paginate --jq '[.[] | {filename, status}]' | jq -s add > pr-files.json
      - run: node scripts/mutation/run.ts pr-files.json
      - if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: mutation-report
          path: reports/mutation/
          if-no-files-found: ignore
          retention-days: 14
```

It does not wait for `test`: it starts in parallel; if the suite is red Stryker's initial run fails too and the job goes red with it.

- [ ] **Step 7:** `CLAUDE.md` Dev commands gets: `` - `pnpm mutation --mutate <src files>`: mutation testing (Stryker); CI job `mutation` runs it on the PR's changed `src/` files (not required). ``
- [ ] **Step 8:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` → all pass. Commit `Mutation testing job in CI` (hook must pass).
- [ ] **Step 9:** Push. The PR itself changes no `src/` file, so its own `mutation` run must print `No src/ files to mutate.` and pass. To prove a real run once, push a throwaway commit touching a comment in `src/domain/settlement.ts`, check the job log shows the marked block with `src/domain/settlement.ts:<line>` survivors, then revert that commit (a new revert commit, never a force-push). Record the run link in the PR brief.

### Task 3: Tests judge reads the report

**Files:**
- Modify: `.claude/skills/judge-tests/SKILL.md`, section "Prove a gap with a mutant" only (steps 1 to 5 and the `Failure:` shape). Keep the rest of the file byte-identical. [#154 Judges running in parallel mix up their PR reviews](https://github.com/SlatinskyJ/taskmaster/pull/154) edits steps 1 and 5 of the same section; whichever PR merges second takes this PR's version of those steps (the worktree advice is moot when the judge mutates nothing). The thread building #154 is told.

- [ ] **Step 1:** Replace steps 1 to 5 with:
  1. Find the `mutation` job for the PR head: `gh api "repos/SlatinskyJ/taskmaster/commits/<head sha>/check-runs?check_name=mutation" --jq '.check_runs[0] | .id, .status, .conclusion'`. Still running → wait and check again (it can take up to 45 min). Failed or missing → say so in the summary; every gap is then by reading, so a `nit`.
  2. Read the report: `gh api repos/SlatinskyJ/taskmaster/actions/jobs/<id>/logs`, the lines between `=== mutation report ===` and `=== end mutation report ===`.
  3. Each `Survived` or `(no test)` mutant on a line the PR changed is a gap candidate. Drop equivalent mutants (the change can't alter behaviour, e.g. a log message). A survivor on a line the PR did not change is `pre-existing`.
  4. Do not edit code or run mutants yourself.
- [ ] **Step 2:** New `Failure:` shape: `` Failure: <file>:<line> <mutator>: <original> → <replacement> survives (mutation job <job id>); <what a person or the data would then see> ``. "A gap you ran no mutant for is a `nit`" becomes "A gap no mutant in the report shows is a `nit`". Summary line: `` Mutants: <n> in report, <k> survive on changed lines. <most important point> ``; "Claim covered only for lines whose mutant you ran and saw fail" becomes "…whose mutants the report shows killed". The common mistake "Run the mutant" becomes "Check the report".
- [ ] **Step 3:** Commit `Tests judge reads the mutation report`.
