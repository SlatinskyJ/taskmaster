# Public demo environment: design

Status: design, agreed with Jakub 2026-11-27 (thread "Plan demo environment setup"). Issue #322.
Host, hostname, proxy and container limits live in Jakub's private notes, never in this repo.

## Intent

Jakub wants people to try Taskmaster on their own: a public demo, the same deployment as
production, with dummy data, every role (admin included, because some features need the admin to
show them), and the multi-user viewer so one visitor can watch several users side by side. It
must not slow production down, and it must not let anyone use the domain for phishing.

## Goals

- One environment setting, `TASKMASTER_ENV=demo`, turns the demo on. It implies everything below,
  so a demo cannot be half-configured. Previews keep `TASKMASTER_ENV=preview` and do not change.
- **Demo data.** On an empty database the demo seed runs as on previews (seed `demo`: every
  piece, every launch switch on), with the known demo password. All four accounts are public.
- **Login page lists the accounts** (Jakub: option A). Under the normal form, four buttons log
  in with one tap: Admin, Táta, Anička, Béďa. A link "Více zařízení" opens `/dev/multi`.
- **Dev pages on.** `/dev/multi` and `/dev/ui` work as on previews, frame login included.
- **Demo marker, always visible.** Every screen, the login page included, shows that this is the
  demo (for example a thin strip "Demo" at the top of the app shell). Never shown outside demo.
- **Demo lock, enforced on the server.** On the demo these are refused with an error, and their
  screens show the controls disabled:
  - changing your own password, an admin resetting a password;
  - creating a user, editing a user (name, role, active);
  - flipping a launch switch (Správa → Funkce shows the toggles, disabled);
  - every passkey function (passkeys are off on the demo even if `WEBAUTHN_RP_ID` is set).
- **Links removed.** On the demo the server deletes, without a notice, every part of a text
  input that starts with `http://`, `https://` or `www.` (case-insensitive) up to the next
  whitespace, before it is validated and stored. Plain domains like `name.cz` stay (Jakub). One
  place for every server function (function middleware), so a new form cannot miss it.
- **Nightly reset** at 03:00 Prague: the host stops the app, deletes its data volume and starts
  it; the seed fills the empty database with fresh dates. Everyone is logged out. A manual
  `reset` command does the same at any time.
- **Auto-deploy.** A CI job `deploy demo` runs after `deploy prod` succeeds, so the demo never
  runs a build production rejected, and never blocks or rolls back production. It has its own
  GitHub environment, Tailscale tag and secrets (the PR names them and hands Jakub the list).
- **Own controller.** `deploy/demo/tm-demo`, the login shell of the demo host's `deploy` user,
  reuses the production controller's deploy steps and adds `reset`. The production controller
  never gets a `reset` command, so nothing on the production host can wipe the family's data.
  The nightly reset is a host timer calling `tm-demo reset`; Jakub can also run it by hand.
- **Search engines kept out:** `noindex` on every page of the demo.

## Non-goals

- A secret demo password or per-visitor accounts.
- Keeping visitors' changes past the nightly reset.
- Backups or off-site copies of demo data (the deploy's own pre-deploy copy stays; it is harmless).
- Suggestions sent to GitHub: the demo has no `SUGGESTIONS_GITHUB_TOKEN`, so *Poslat na GitHub*
  stays disabled as the spec already says for a missing token.
- Filtering offensive or junk text (Jakub is not worried about it; the reset clears it).

## Anti-goals

- The demo slows down production on the same host. The container gets hard CPU, memory, process
  and disk limits on the host (private notes); the app adds a cap on successful logins per IP
  and on open live-change streams per IP. These caps apply only on the demo; production
  (a family behind one home IP) is unchanged.
- One visitor locks an account for everyone by typing wrong passwords. On the demo the
  per-username failure limit is off for the four demo accounts; the per-IP limit stays.
- A visitor can post a clickable link or host a page on the domain. The app already shows free
  text as plain text only (no links, HTML or uploads); link removal is a second wall.
- One visitor locks the others out until the reset (the demo lock).
- Any of this reaches production: every demo branch checks `TASKMASTER_ENV=demo`, and the demo
  seed and frame login keep refusing when `ADMIN_PASSWORD` is set.

## Approaches

1. **One setting `TASKMASTER_ENV=demo`** (picked). `devPagesAllowed` and the seed accept
   `preview` or `demo`; the lock, link removal, marker, login buttons and noindex check `demo`
   only. One value, nothing to forget.
2. `TASKMASTER_ENV=preview` plus a separate `DEMO_LOCK=1`. Rejected: a demo without the lock is
   one forgotten line away, and the lock would then be open on a public host.
3. A permanent preview slot on the preview host. Rejected: not the production deploy path Jakub
   asked for, and previews are tailnet-only by design.

## Where it is written down

This document, plus a short bullet in the main spec §6 next to the multi-user viewer, both in
this design's own PR (Jakub merges it, as with the viewer).

## Calls made by Claude (Jakub may overturn)

Own controller script with `reset` (prod gets none); `deploy demo` after `deploy prod`; caps
demo-only; per-username failure limit off on the demo accounts; link removal silent.

## Decided by Jakub (2026-11-27)

Public; own container; hostname (private notes); every login public, admin included; nightly
reset (he first chose manual, then a nightly reset after the risk talk); lock covers password
change and reset, user edits, switches (shown disabled, refused by the server) and passkeys;
links starting with `http://`, `https://` or `www.` removed; `/dev/ui` on; login option A; demo
marker on every screen.

## Left to the builder

- Czech texts for the marker, the account buttons, "Více zařízení" and the lock's error (in
  `src/lib/strings.ts`, UX judge).
- Login and stream cap numbers (low enough for a Pi, high enough for a visitor with 4 frames).
- How the client learns it is on the demo (for example with the existing env server function).
- Which inputs are exempt from link removal (passwords and usernames at login are the obvious
  ones).
- The split into PRs (likely: env + lock + link removal; login page + marker + noindex; CI job +
  controller `reset`).

## Ops outside the repo (Jakub, private notes)

Incus container with hard limits, Docker inside, its `.env` (`TASKMASTER_ENV=demo`,
`TRUST_PROXY=1`, no `ADMIN_PASSWORD`, no token, no `WEBAUTHN_*`), outbound traffic blocked like
previews, a timer for the nightly reset, an Apache vhost with its own certificate and the
`flushpackets` setting for live changes. VPS work only in the evening, backup first.
