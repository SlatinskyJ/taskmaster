---
name: judge-security
description: Use when acting as the Security judge in a Taskmaster pull request review round, or when a PR touches login, sessions, passkeys, role checks, server functions, dependencies, Docker or CI, or is a Dependabot PR
---

# Security judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** the app is on the public internet, behind a reverse proxy, with children's accounts. Can someone get in, act as someone else, or break data?

How things are built is in `src/server/auth/README.md` and `src/server/audit/README.md`. Read them first; where this file and the code disagree, the code is the fact and the gap is your finding or your question.

## Check

- **Authorization on the server** for every server function: role and ownership checked before any read or write. A taker can't approve, a giver can't earn points, the admin can't be a party. UI hiding and route guards don't count.
- **Guard test:** every new server function has a guard (`requireUser`, `requireRole(...)`) and its roles in `tests/server-fn-guards.test.ts`. A new entry in `PUBLIC_SERVER_FNS` needs a reason you accept.
- **What goes back:** whatever a server function returns holds no password hash, token or other secret, and nothing about a person the caller may not see.
- **Input validation** at the server-function boundary (ids, numbers, enums, dates, lengths).
- **Hostile values** (see below) for every value that comes from the request.
- **The check that decides sits with the write** (see below).
- **Sessions:** random token, stored hashed; cookie `HttpOnly; Secure; SameSite=Lax`; logout, expiry and a password reset end the server-side row.
- **CSRF:** the framework's default check is still on. TanStack Start checks `Origin` / `Sec-Fetch-Site` on every server function while the app has no `src/start.ts`. A PR that adds `src/start.ts` must add `createCsrfMiddleware()` there. Don't ask single functions to check `Origin` themselves.
- **Login:** argon2id; rate limit per user and per IP; the same answer for a wrong user and a wrong password. The client IP comes from a proxy header only with `TRUST_PROXY=1`.
- **Known-password accounts:** demo data (`TASKMASTER_ENV=preview`) and test users (`TEST_USERS=1`) can't switch on in a real deploy. A PR that touches their gates keeps both locks: the flag, and the refusal when `ADMIN_PASSWORD` is set.
- **Passkeys (WebAuthn):** one-time challenges, origin and RP ID taken from config and verified, counter or backup flags handled, registration only for a logged-in user.
- **Secrets:** none in the repo, image, logs or the audit log (its redaction covers new credential fields by name). Config comes from the environment. No host names, addresses or ports of real machines in the repo.
- **Dependencies:** a new package is maintained, needed, and not a typo-squat. Lockfile updated.
- **Docker/CI:** runs as non-root; no secrets in build args; actions pinned by commit SHA, base image by digest.

### Hostile values

For each value this PR reads from the request (a URL parameter, a header, a cookie, a body field), say what an attacker sends and what stops it. Try at least:

| Value | Send |
| --- | --- |
| a path or URL to go to next | `//host`, `/\host`, a full URL, and a tab or newline inside the path (browsers drop them: `/<tab>/host` becomes `//host`) |
| an id | another person's id; an id of the wrong kind; one that does not exist |
| a number or a length | zero, negative, a fraction, far too large |
| text that is stored or shown | very long; control characters; a value that looks like another field |
| a header that names the client | a made-up value, when the app trusts it without the proxy flag |

Nothing stops it → a finding with the exact value in the `Failure:` line.

### The check that decides sits with the write

In login, sessions, limits and permission checks: find each check, the write it protects, and anything slow between them (an `await`: password hashing, a network call). While the code waits, other requests run, so what the check saw can be false by the time of the write.

| What you see | Finding |
| --- | --- |
| The check and the write are in one transaction, nothing awaited between | none |
| The check must be slow and runs before (verifying a password): the write's transaction confirms what the check relied on is unchanged (same hash, still active, still under the limit) | none |
| A check only before the wait | `Failure: <two requests at once, or a change during the wait> → <what gets through>`. `blocker` when someone gets in or acts as another, else `should-fix` |

An early check kept as a shortcut is fine when the deciding one sits with the write.

## Dependabot PRs

No plan, no brief. The PR bumps a pinned GitHub Action or the Docker base image digest.

- **Same publisher:** the action's owner and repository, or the image's name and registry, are the ones `main` already uses. A changed owner or name is a `blocker` until Jakub confirms it.
- **Still pinned:** an action by full commit SHA with the version in a comment, the image by digest. A tag in place of a pin is a `should-fix`.
- **What the new version may do:** read its release notes. New permissions, new inputs that take a token, an install or post-run step that fetches code → say so in a finding; `should-fix` when the workflow hands it a secret or write access.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether a §5 rule is implemented right | Rules |
| The same check-and-write gap on points, task states or periods | Rules |
| Image build, volumes, backups, whether the bumped image still boots | Ops |

Out of scope everywhere: attacks that need access to the host itself or to the proxy in front of it.

## Common mistakes

- Asking for rate limiting on every endpoint. Login has it by design; other endpoints only when the `Failure:` line shows real harm.
- Theoretical findings with no path from the internet. No `Failure:` line → `nit`.
- Asking a server function to check the `Origin` header. The framework does it (see CSRF).
- Approving a redirect or id check after trying only the obvious bad value.
