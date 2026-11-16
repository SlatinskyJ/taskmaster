---
name: judge-ops
description: Use when acting as the Ops judge in a Taskmaster pull request review round, or when a PR changes the Dockerfile, CI workflows, the migration runner, backups, the Cloudflare Tunnel or deploy config
---

# Ops judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** will the next update on SLNAS (Synology, ~2 GB RAM, arch unknown, Docker via Container Manager) go fine, and is the data safe?

## Check

- **Multi-arch:** the image builds for amd64 and arm64. Native modules (`better-sqlite3`, argon2) have builds for both.
- **Data:** the SQLite file lives on a mounted volume, never in the image layer. WAL files are on the same volume.
- **Migrations:** run once on start, inside a transaction. A failure stops the app and leaves the DB as it was.
- **Backups:** still cover the DB file. A consistent copy is taken (SQLite backup API or `VACUUM INTO`), not a raw file copy during writes.
- **Resources:** memory fits comfortably in about 2 GB shared with DSM. Health check present.
- **Tunnel:** the `cloudflared` service and hostname `taskmaster.slatinsky.cz` are intact.
- **CI:** required checks still report on every PR. Docs-only PRs may skip them via the `changes` job (#78), but anything else, and every push to `main`, runs them all. The image is built and pushed only from `main`.

## Not your lane

| Concern | Judge |
| --- | --- |
| Secrets, non-root, pinned actions | Security |
| App features | Rules, UX |

## Common mistakes

- Asking for Kubernetes-grade tooling (orchestration, monitoring stacks). This is one container for 5 people.
