---
name: judge-ops
description: Use when acting as the Ops judge in a Taskmaster pull request review round, or when a PR changes the Dockerfile, CI workflows, what runs when the server starts, the preview host files, backups or deploy config, or is a Dependabot PR
---

# Ops judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** one container, one SQLite file on a mounted volume, a small home server with little memory. Will the next start of a new image go fine, and is the data safe?

What exists today: the image (`Dockerfile`), CI (`.github/workflows/ci.yml`), what runs at start (`src/server/plugins/`), and the preview host (below). The real deploy and its backups are not built yet. Where machines live and what they are called is not in this repo and does not go into it: no host names, addresses or ports of real machines in code, docs or your findings.

## Check

- **Both architectures:** the image builds and starts on amd64 and arm64; both are in use. A new native module (it compiles or ships a binary, like `better-sqlite3` or argon2) has a build for both, and the CI job `image` smoke-runs each.
- **Data:** the SQLite file lives on the mounted volume (`DATA_DIR`), never in an image layer. WAL files are on the same volume. The container runs as non-root and can still write there.
- **Start (below):** whatever runs when the server starts.
- **Resources:** memory stays small (the host has about 2 GB for everything). The health check answers only when the app can really serve.
- **What the edge may cache:** a file whose content changes between deploys under the same URL (the service worker, the manifest, HTML) goes out with `cache-control: no-cache`; hashed assets may be `immutable`.
- **CI:** required checks still report on every PR. A PR that changes only Markdown may skip them via the `changes` job. Any other file, a failed file lookup, and every push to `main` run them all. The image is built and pushed only from `main`. A new check that should gate merges is named so a skipped run still reports.
- **Once they exist** (the deploy and backup work is planned, not built): a backup takes a consistent copy (SQLite backup API or `VACUUM INTO`, never a raw file copy during writes) and still covers the DB file; an update keeps the volume and can go back to the previous image.

### Start

Everything in `src/server/plugins/` and what it calls runs on every start, before the first request: open the DB, apply migrations, seed, create the first admin, warn about config.

| Question | Wrong answer → finding |
| --- | --- |
| What happens on the second start, and the hundredth? | It writes again, or fails because the first start already did the work |
| What happens when a step fails? | The server serves anyway on a half-done state; or it stops with no log line that says which step and why |
| A migration fails half-way | The DB is not as it was before the start (each migration runs in a transaction; a failure stops the app) |
| Does the order matter? | A step reads what a later step creates |
| Does it need a setting? | A missing or wrong value is silent; the start log should say what is off, without printing a secret |

A PR that changes the start code shows the start log of a first and a second start in its brief, or you run them yourself, in your own worktree (never the shared checkout; the build writes `.output/` and `src/routeTree.gen.ts`): `git worktree add <scratch>/ops-judge-<pr> origin/<branch>`, `pnpm install --frozen-lockfile`, then `pnpm build && DATA_DIR=<tmp> node .output/server/index.mjs`, twice; `git worktree remove --force <scratch>/ops-judge-<pr>` when done.

### Preview host

Files: `.github/workflows/preview*.yml`, `deploy/preview/`, `docs/runbooks/preview-host.md`. CI never changes the host; the controller script is copied there by hand.

- **Script changed** (`deploy/preview/tm-preview*`, even a comment: its `version` is a hash of the file): the host copy is out of date after the merge. The PR brief and PR body say that a hand push is needed, and the runbook step for it still fits. Not said → `should-fix`.
- **Slots:** taking the `preview` label off, and closing or merging the PR, each remove the preview and free its slot. A deploy that finds no free slot says so on the PR and leaves no half-made preview.
- **Never in the way of a merge:** no preview job is a required check; a host that is down or full fails only the preview job.
- **Memory:** the cap on previews times the memory cap of one preview fits in the limit the runbook gives the host container, with room to spare. A PR that raises one raises the other, in the runbook too.
- **Runbook in the same PR:** a change to how the host is set up, updated or recovered changes `docs/runbooks/preview-host.md` in this PR.
- **What a preview may reach:** demo data only (`TASKMASTER_ENV=preview`), no production secret, and the workflow gives the host step no token it does not need.

## Dependabot PRs

No plan, no brief. The PR bumps the Docker base image digest or a pinned GitHub Action.

- **Image bump:** the CI job `image` is green on amd64 and arm64 (it starts the container and waits for its health check). Same Node major and same Debian release as before; a change of either is a `should-fix` that asks for Jakub's yes. Still pinned by digest.
- **Action bump:** the jobs that use it ran in this PR's CI and passed. A job that only runs on `main` (image push) did not run: say so in the summary, and read the action's release notes for changed inputs or defaults.

## Not your lane

| Concern | Judge |
| --- | --- |
| Secrets, non-root as an attack surface, who published an action | Security |
| Whether a migration is safe for the data already there | Architecture |
| App features | Rules, UX |

## Common mistakes

- Asking for Kubernetes-grade tooling (orchestration, monitoring stacks). This is one container for 5 people.
- Judging a deploy, tunnel or backup that is not in the repo yet. Until those files exist there is nothing to check; the lines under "Once they exist" are for the PR that adds them.
- Writing a host name or address into a finding. Say "the preview host" or "the home server".
