Brief: <!-- artifact URL from the pr-brief skill; `after the build` during the plan phase -->

Closes #<!-- issue -->

## What this delivers
<!-- One or two sentences, user-facing -->

## Stack
<!-- Stacked PRs only: list the stack, mark this one. Otherwise delete. -->

## Review
Plan: <!-- path of the plan file; `removed in <sha>` once the build is done; `none (ad-hoc)` for a PR with no issue -->
Plan round: 0/5
Judges: <!-- e.g. Rules, Architecture, Tests -->
Review round: 0/5
Trivial: no <!-- yes only if no protected area is touched (CLAUDE.md) -->

## Checklist
- [ ] CI green (lint, typecheck, unit tests, build, migration check)
- [ ] Plan approved by the judges, built, and its file deleted from the branch (or no plan: ad-hoc)
- [ ] PR brief linked and up to date
- [ ] Pre-existing problems filed as `follow-up` issues, not fixed here
- [ ] No spec behaviour changed without Jakub's OK
