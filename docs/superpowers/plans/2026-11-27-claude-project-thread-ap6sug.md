# Skip the app build on PRs that change only tooling: implementation plan

Issue: [#349 Skip the app build on PRs that change only tooling](https://github.com/SlatinskyJ/taskmaster/issues/349). Spec: §11 (CI) only; no app behaviour changes.

**Goal.** A PR whose files are all docs or tooling skips `build` and every step of `image (amd64/arm64)`. `typecheck`, `lint`, `format`, `migrations`, `test` (and `mutation`) keep their current rule (#78: skip only for docs-only).

**Size.** About 95 changed lines outside tests (ci.yml ~30, new `scripts/ci/changes.ts` ~55, preview.yml 1 comment line), plus one test file (~80).

## Definitions

- **docs** (unchanged from #78): `^((docs|\.claude)/.*\.md|[^/]+\.md|\.github/[^/]+\.md)$`.
- **tooling**: `scripts/**` **except** `scripts/ci/**`; `tests/<prefix>*.test.ts` where `<prefix>` is `judge-review-`, `merge-queue-`, `mutation-`, `mutation.` or `red-main-` (the tests of `scripts/`; `tests/support/`, the guard tests and `tests/ci-*` are app); `.claude/**`; `.github/workflows/*.yml` **except** `ci.yml` and `preview*.yml`.
- **runs everything** (counted as app even though it is tooling): `ci.yml` and `preview*.yml` (they define or deploy the build and image), and `scripts/ci/**` with `tests/ci-*.test.ts` (the classifier itself: the `changes` job runs the PR's own copy, so a PR that edits it must not be judged by its own new rule).
- `code` = some file is not docs. `app` = some file is neither docs nor tooling.
- Fail closed: empty or unreadable file list, or any non-PR event, gives `code=true app=true`.
- Renames count both names (already the job's behaviour).

Deliberately left out: an ESLint guard against `src/` importing `scripts/`. Jakub, 2026-11-27: "we can worry about it when that happens".

## Tasks

### 1. Pure classifier, tests first

`tests/ci-changes.test.ts` (vitest), red first, for `classify(files: string[]): { code: boolean; app: boolean }` in `scripts/ci/changes.ts`:

- `[]` → both true (fail closed).
- `README.md`, `docs/x.md`, `.claude/skills/a/SKILL.md`, `.github/pull_request_template.md` → both false.
- #346's real file list (scripts/merge-queue/*.ts, tests/merge-queue-*.test.ts, .claude/skills/*, CLAUDE.md, .github/workflows/merge-queue.yml) → code true, app false.
- each tooling kind alone (`scripts/a.ts`, `scripts/merge-queue/run.ts`, `tests/red-main-run.test.ts`, `tests/mutation.test.ts`, `tests/mutation-run.test.ts`, `tests/judge-review-combine.test.ts`, `.claude/settings.json`, `.github/workflows/red-main.yml`, `.github/workflows/merge-queue.yml`) → code true, app false.
- boundaries that stay app: `src/x.ts`, `tests/screen-guards.test.ts`, `tests/support/passkeys.ts`, `tests/merge-queuex/a.ts` (no nested dir), `.github/workflows/ci.yml`, `.github/workflows/preview.yml`, `.github/workflows/preview-host.yml`, `.github/workflows/preview-cleanup.yml`, `scripts/ci/changes.ts`, `tests/ci-changes.test.ts`, `tests/city-map.test.ts` (prefix needs its hyphen), `.github/dependabot.yml`, `package.json`, `pnpm-lock.yaml`, `Dockerfile`, `e2e/a.spec.ts`, `docs/x.ts`, `xscripts/a.ts` → app true; each also mixed with a tooling file → app true.

### 2. CLI entry point

`scripts/ci/changes.ts` also runs as `node scripts/ci/changes.ts` (guarded by `import.meta.main`): reads newline-separated names from stdin, prints `code=<bool>` and `app=<bool>` lines (the job appends them to `$GITHUB_OUTPUT`) and a one-line reason. No dependencies, so it runs without `pnpm install`. Blank lines are dropped (the `gh --jq` list ends with a newline). Tests, through the real entry point (vitest spawns `node scripts/ci/changes.ts`):
- a tooling-only list ending in a newline → `code=true`, `app=false`;
- empty stdin → `code=true`, `app=true`;
- an app list → `app=true`.

### 3. ci.yml

- `changes` job: add output `app`. Add `actions/checkout` (pinned SHA as elsewhere, `persist-credentials: false`, `sparse-checkout: scripts/ci`) and `actions/setup-node` with `.nvmrc` (no pnpm cache). Keep the non-PR and unreadable-list early exits, now writing both outputs as `true`. Otherwise pipe the file list into `node scripts/ci/changes.ts >> "$GITHUB_OUTPUT"`; if the script fails, write both `true` (fail closed).
- `build`: `needs: [changes, typecheck, lint, format]`, `if: needs.changes.outputs.app != 'false'`.
- `image`: `env.CODE` takes `needs.changes.outputs.app`; step-level skips stay, so `image (amd64)` / `image (arm64)` still report.
- `preview` job: condition uses `outputs.app` (a skipped image has no artifact to deploy).
- Update the comment block above `changes` and above `image`.
- `preview.yml`: comment "Docs- and tooling-only PRs build no image".

Required checks: `build` skipped by its `if` passes (comment at the top of `jobs:`); `image` matrix still expands.

### 4. Verify

- `pnpm test tests/ci-changes.test.ts`, then `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (pre-commit hook).
- This PR changes `ci.yml`, so its own CI must run everything. Check it, don't assume (a skipped job also shows green): read the head commit's check runs (`gh api repos/SlatinskyJ/taskmaster/commits/<sha>/check-runs`) and the `changes` job log, and record in the brief that `changes` printed `app=true` and that `build`, `image (amd64)` and `image (arm64)` ran with conclusion `success` and their steps were not skipped (job steps API). After merge, the first tooling-only PR (#346 once updated with `main`) shows `build` skipped and green; note that in the brief.
