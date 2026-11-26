# Taskmaster: rules for agents

Family chore-points web app. Read `HANDOFF.md`, then the spec `docs/superpowers/specs/2026-11-16-taskmaster-design.md`. **The spec is the source of truth.** Don't change its behaviour without Jakub's OK. Items marked **[call]** are defaults he may overturn. The stack is in spec §11.

- UI labels in Czech. Code, identifiers, DB, commits and logs in English.
- Owner: Jakub (GitHub `SlatinskyJ`). He reads PR briefs, not diffs; briefs may show crucial code (skill `pr-brief`).

## Work tracking

- Planned work is a GitHub issue. Epics are parent issues with sub-issues; one issue ≈ one PR. Small ad-hoc work (a quick ask, a rules or skill tweak) gets no issue: the PR is the only item.
- Labels. Agents add no other label, and never create new ones.
  - Issues only: `feature`, `bug`, `chore`, `follow-up` (deferred from review), `epic`. A PR takes its type from its issue (`Closes #<issue>`); an ad-hoc or Dependabot PR has no type label.
  - PRs only: `preview` (see PR flow step 5), `merge-me` (Jakub accepts the PR). Only Jakub adds `merge-me`; an agent only takes it off (skill `merge-approved-prs`).
  - Either: `needs-jakub`, only while a question to Jakub is open (asked in a PR or issue comment mentioning him and in the project thread). Take it off when he answers. Ready for review is not a question.
- Milestones are releases (e.g. `v1 trial week`). The GitHub Project board picks issues up by its own automations.
- A PR for an issue says `Closes #<issue>`.
- When you mention an issue or PR to Jakub (thread, brief, PR body), give its title and a GitHub link, e.g. [#61 Prepare the preview host](https://github.com/SlatinskyJ/taskmaster/issues/61). Never a bare number.
- Name the branch and the PR after the issue: branch `<n>-<short-slug>` (e.g. `14-scaffold`), PR title = the issue title, with no `#<n>` prefix (issues and PRs share one number counter, so the prefix shows a different number than the PR's own). Ad-hoc PRs: branch `<short-slug>`, a plain title. The agent owns that issue's workflow: assignee set, a comment when the PR opens and when it is blocked or ready, `needs-jakub` on/off by the rule above. Board status moves by the board's automations.

## Dev commands

Node 22 + pnpm (`corepack enable`). `pnpm install` also installs the lefthook pre-commit hook.

- `pnpm dev`: dev server on port 3000
- `pnpm build` then `pnpm start`: production server (`.output/`)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (or `pnpm format`), `pnpm test`
- `pnpm mutation --mutate <src files>`: mutation testing (Stryker). CI job `mutation` runs it on a PR's changed `src/` files and lists surviving mutants; not a required check.
- `pnpm db:generate --name <change>`: write a migration after editing `src/server/db/schema/`; commit `drizzle/`. `pnpm db:check`: schema and migrations agree and apply to an empty DB (CI job `migrations`). Never edit a committed migration.
- DB code: `src/server/db/` (`getDb()`; tests use `createTestDb()` from `~/server/db/testing`). The server migrates on boot. SQLite file: `$DATA_DIR/taskmaster.db` (`.data/` in dev).
- Audit: every state change goes through `withAudit` (`src/server/audit/`, see its README).
- Dates: all Prague wall-clock maths through `src/domain/dates.ts`; store UTC (`toIsoUtc`). Czech UI text only in `src/lib/strings.ts`.
- `src/domain/`: §5 rules, framework-free; ESLint blocks React, TanStack, DB and Node imports there.
- Demo data: `TASKMASTER_ENV=preview` seeds an empty DB at boot (`src/server/demo/`): `admin`, `tata`, `starsi`, `mladsi`, password `demo1234`. PR previews run with it. The seed is built from pieces (`src/server/demo/pieces.ts`, one per feature's sample data); `TASKMASTER_SEED` picks a named list of them (`seeds.ts`, default `demo`: every piece, every launch switch on, for previews). Each e2e spec file has its own row in `e2e/suites.ts`: own server, own DB, own seed. A feature PR adds its piece to `demo` and gives its e2e suite the seed it needs. A seed lists the launch switches (`feature_flags`, `src/lib/features.ts`) it turns on, so a feature behind a switch is never blocked in tests or on its preview; production switches stay off until Jakub flips them (`src/server/features/README.md`).
- Image: `docker build -t taskmaster .` then `docker run -p 3000:3000 -v tm-data:/data taskmaster`; health at `/api/health`. The app keeps its SQLite file in `DATA_DIR` (`/data` in the image; mount a persistent volume there). CI pushes `ghcr.io/slatinskyj/taskmaster:main` (amd64 + arm64) after every green `main`.
- Forms on a phone: the keyboard covers about half the screen. Rule (Jakub): the field a person types into is visible while they type, also when a sheet or dialog focuses it on open; the send button may be under the keyboard if the page scrolls to it. The bottom sheet (vaul `Drawer`) moves above the keyboard by itself; a centred `Dialog` does not. Every form screen gets a case in `e2e/keyboard.spec.ts` (`e2e/keyboard.ts`: simulated iPhone keyboard) and keyboard-open screenshots for the UX judge and the brief.
- `src/routeTree.gen.ts` is generated by the router plugin on `dev`/`build`; commit it. Tests of route components live outside `src/routes` (the router generator warns on non-route files there).
- Component tests render static markup only (no DOM library): put form logic in a plain module and unit-test that; test interactions in e2e.
- **Production deploys itself:** every green `main` runs the CI job `deploy prod`, and the server runs migrations on boot. So a merge is a release. Launch switches load at app start: after flipping one, the PWA must be fully reopened.

## PR flow

A PR that closes an issue is judged twice in the same PR: first its **plan**, then its **code**. A PR with no issue (ad-hoc) and a Dependabot PR have no plan: they skip steps 2 and 3. So does a **small PR**: it expects to change at most about 300 lines (not counting tests, migrations and generated files) and touches none of the protected areas (Trivial PRs below). Its body says `Plan: none (small, about <n> lines)`; the Architecture judge checks the claim in code round 1.

1. **Branch** from `main`. One feature per PR. Bigger features become **stacked PRs**, each one logical step that passes CI alone.
   - Link a stack as a **GitHub stack** once its PRs are open: each PR's base is the branch of the PR below it, then
     `echo '{"pull_requests":[<bottom>,<next>,...]}' | gh api -X POST repos/SlatinskyJ/taskmaster/stacks --input -`.
     Add a PR on top later with `POST .../stacks/<stack number>/add` (same body). Find a PR's stack with
     `gh api 'repos/SlatinskyJ/taskmaster/stacks?pull_request=<n>'`. Give Jakub the stack link
     `https://github.com/SlatinskyJ/taskmaster/stack/<stack number>`.
2. **Plan.** Write the implementation plan with skill `superpowers:writing-plans`, as `docs/superpowers/plans/<date>-<branch name>.md`. Commit the plan alone and open the PR as a **draft**. Run the plan rounds (skill `pr-review-rounds`): the judges review the plan. At most **5 rounds**. Their approval is the go-ahead to build; Jakub does not review plans.
3. **Build** the approved plan with skill `superpowers:executing-plans`: tests first (`superpowers:test-driven-development`), bugs and red tests through `superpowers:systematic-debugging`, and `superpowers:verification-before-completion` before you call anything done. The plan file stays on the branch while you build. It is your memory when your context is compacted: reread it, don't rebuild it from memory.
4. Commit only after the pre-commit hook passes (format, lint, typecheck). Never `--no-verify`. CI must pass: lint, typecheck, unit tests, build, migration check.
5. **Clean up, then ready.** When the build is done, delete the plan file in a commit of its own. Write the PR brief (skill `pr-brief`) and put its link first in the PR body. Mark the PR ready. If the PR changes something a user sees (screens, flows, styles, Czech text), add the `preview` label in the same step, never on a draft. The label deploys a preview environment on the preview host, redeploys it on each push and holds one of its 10 slots until the label comes off or the PR closes; when no slot is free CI takes the label off again. Leave it off for CI, docs, rules and backend-only PRs. Take it off if the PR goes back to draft. The plan is deleted at this point and not before; it never reaches `main`.
6. Run the review rounds (skill `pr-review-rounds`): a panel of judges (skills `judge-rules`, `judge-security`, `judge-architecture`, `judge-ux`, `judge-tests`, `judge-ops`) reviews the diff, not the plan. At most **5 rounds**.
7. **Jakub merges** (squash). His merge is the approval. Agents merge only trivial PRs, or PRs Jakub labelled `merge-me` when he asks an agent to land them (skill `merge-approved-prs`).

Where a superpowers skill and this file differ, this file wins:

| The superpowers skill says | Here |
| --- | --- |
| ask your human partner to review the plan and pick how to execute it | the judges review the plan (step 2); execution is `superpowers:executing-plans` |
| decide conflicts yourself and record a ruling | only for a mistake in the plan. A spec that is wrong, unclear or silent → ask Jakub (Hard rules). Every ruling goes into the PR brief |
| final whole-branch review by a fresh reviewer; `superpowers:requesting-code-review` | the judges' review rounds (step 6) |
| `superpowers:finishing-a-development-branch` | steps 5 to 7 |

PR size is a soft goal of about 400 changed lines (not counting tests, migrations and generated files). Every judge reads the whole diff every round, so size is the biggest token cost: split into stacked PRs whenever the parts can land one after the other. A PR goes over 400 only for a good reason, which its plan states. Over about 600 the Architecture judge says so in the plan round, and asks for a split when the reason does not hold. Parallel PRs are fine; `main` requires branches to be up to date, so update your branch after other merges.

## Dependabot PRs

Dependabot bumps the Docker base image digest and the pinned GitHub Actions (`.github/dependabot.yml`). Its PRs get no issue, plan, brief or full panel: CI (including the image smoke test) must be green, an agent asked to handle one runs the Ops and Security judges, and Jakub merges.

## Trivial PRs

A PR is trivial only if it touches **none** of the protected areas below, and the Architecture judge agrees. Any doubt → not trivial → ask Jakub (label `needs-jakub`).

Protected areas:
- DB schema, migrations, the audit log;
- the §5 domain layer (agreement, lifecycle, periods, settlement);
- auth, sessions, passkeys, role checks;
- the scheduler;
- CI, Docker, deploy, backup config;
- new or upgraded dependencies (patch bumps excepted);
- shared modules other code depends on (date helpers, theme tokens, the Czech strings module).

## Hard rules

- No code for an issue before the judges approved its plan (a small PR, PR flow above, has no plan). No plan file in a PR that is ready for review, and none on `main`.
- Never skip, delete or weaken a test to get green.
- Never fix the spec inside a PR. If the spec is wrong or unclear, stop and ask Jakub.
- Problems that were already there before your PR → a `follow-up` issue, not a fix in your PR.
- Every state change writes its audit entry in the same transaction.
- Ask Jakub when unsure: label `needs-jakub`, a PR comment mentioning him, and a message in the project thread.
