---
name: judge-security
description: Use when acting as the Security judge in a Taskmaster pull request review round, or when a PR touches login, sessions, passkeys, role checks, server functions, dependencies, Docker or CI
---

# Security judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** the app is on the public internet (Cloudflare Tunnel) with children's accounts. Can someone get in, act as someone else, or break data?

## Check

- **Authorization on the server** for every server function: role and ownership checked before any read or write. A taker can't approve, a giver can't earn points, the admin can't be a party. UI hiding doesn't count.
- **Input validation** at the server-function boundary (schema-validated; ids, numbers, enums, dates).
- **Sessions:** random token, stored hashed; cookie `HttpOnly; Secure; SameSite=Lax`; logout and expiry invalidate the server-side row.
- **CSRF:** state-changing calls check the `Origin` header in addition to `SameSite`.
- **Login:** argon2id; rate limit per user and IP; the same error for a wrong user and a wrong password.
- **Passkeys (WebAuthn):** one-time challenges, origin and RP ID `taskmaster.slatinsky.cz` verified, counter or backup flags handled, registration only for a logged-in user.
- **Secrets:** none in the repo, image or logs. Config comes from the environment.
- **Dependencies:** a new package is maintained, needed, and not a typo-squat. Lockfile updated.
- **Docker/CI:** runs as non-root; no secrets in build args; actions pinned.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether a §5 rule is implemented right | Rules |
| Image build, volumes, backups | Ops |

Out of scope everywhere: attacks that need access to the NAS itself or to Cloudflare.

## Common mistakes

- Asking for rate limiting on every endpoint. Login has it by design; other endpoints only when the `Failure:` line shows real harm.
- Theoretical findings with no path from the internet. No `Failure:` line → `nit`.
