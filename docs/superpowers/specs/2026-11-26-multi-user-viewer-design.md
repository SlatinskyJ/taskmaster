# Multi-user viewer: design

Status: design, agreed with Jakub 2026-11-26 (thread "Test several users side by side").
Wireframe: https://claude.ai/artifact/XF1EyQr2t55bVbP3MfgDz6

## Intent

Testing a flow that crosses users (tata creates a task, starší and mladší bid, tata accepts one)
means logging out and in all the time. Jakub wants one page on a PR preview that shows several
users at once, each in its own phone-size frame, without running anything locally.

The page is "three phones on a desk", nothing more. The frame Jakub clicks in is the phone in his
hand; the others are put down. **The tool must not change how the app behaves.** A frame updates
only when the app on a real phone would update by itself; otherwise it shows stale data, and
tapping something stale must do exactly what a stale phone would do. That is a thing he wants to
test.

## Goals

- `/dev/multi`: a row of frames. Each frame is the real app, logged in as one demo user.
- Per frame (above it): user picker (admin, tata, starší, mladší), size picker (phone 390×844,
  small phone 360×740, tablet 820×1180), **Obnovit** (reload = close and reopen the app on that
  phone, still logged in), **Odebrat**, and an editable address field showing where the frame is.
- Toolbar: **Přidat telefon**, **Obnovit vše**.
- The same user may be open in two frames (two devices, two sessions).
- The phone in hand (last interacted) is marked subtly.
- Frames side by side, horizontal scroll when they don't fit.
- The layout (frames, users, sizes) is remembered in this browser.
- Works on every PR preview and in `pnpm dev`, from Jakub's browser.

## Non-goals

- Syncing frames, auto-refresh, or "follow" mode.
- Resetting the preview's demo data (possible later issue).
- Faking a phone being picked up (see Known gap).
- Any change in production.

## Anti-goals

- The app behaves differently inside a frame than on a phone (beyond the known gap).
- The page, or the per-frame login, is reachable in production.
- An "act as any user" switch that skips the password.

## Constraints (found in the code)

- The session cookie is `__Host-tm_session` (`src/server/auth/http.ts`): host-only, `Path=/`.
  Frames on one page share it, so each frame needs its own login carried another way.
- Previews are served on one address each; per-user hostnames would mean reworking the preview
  host (rejected below).
- `/dev/ui` already exists behind `devPagesAllowed` (`src/server/env/devPages.ts`: dev, or
  `TASKMASTER_ENV=preview`). The image sets `NODE_ENV=production`; prod never sets
  `TASKMASTER_ENV=preview`.
- Demo users and `DEMO_PASSWORD` come from the demo seed (`src/server/demo/`), which never runs in
  production.
- Auth is a protected area (CLAUDE.md): this needs the Security judge and Jakub's spec OK (this
  doc plus the §6 line).

## Approaches

1. **Per-frame login key (picked by Jakub).** Each frame logs in through the normal `login()` with
   the demo password. On previews and dev only, the server hands that frame its session token
   instead of setting the cookie, and accepts the token from the frame on each request in place
   of the cookie. The app is otherwise unchanged. About 2 PRs, ~350 lines plus tests.
2. **One address per user on the preview host** (`tata.<preview>` …): real cookies, no auth change,
   most faithful. Rejected: needs more names and certificates per preview and deploy changes, the
   biggest job, in the protected deploy area.
3. **No code** (Firefox containers or browser profiles): free, but no single page, no layout, a new
   login after every redeploy. Rejected as the main answer; still usable today.

## Design (approach 1)

### Frame login
- A preview/dev-only server function logs a demo user in by username via the normal `login()` with
  `DEMO_PASSWORD` (so rate limit, inactive accounts and audit behave as usual) and returns the
  session token to the viewer page. It sets no cookie. Outside preview/dev it refuses before doing
  anything.
- Each frame gets its own session, so the same user twice is two sessions.
- The token is a normal session token: same table, same 90-day sliding expiry, same logout.

### Carrying the token
- Every request from a frame (the page load and every server function call) carries the frame's
  token. The server, **only when `devPagesAllowed`**, takes it in place of the cookie. When the
  frame token is present, the cookie is ignored for that request, so a frame never falls back to
  whoever is logged in on the page itself.
- Outside preview/dev the server ignores the frame token completely; the cookie is the only way in.
- A frame always says it is a frame, also when it has no token or a dead one. A frame request never
  falls back to the page's cookie and never sets or clears it. **[call]**
- A frame's logout or a session the server drops ends that frame's login only; the frame shows the
  login screen, as a phone would.
- **Logging in inside a frame works like a phone** (Jakub, 2026-11-26): the frame's own login screen
  (password or passkey) logs in that frame only. Inside a frame the login hands the new token to
  the frame instead of setting the cookie; outside a frame login is unchanged.
- The exact carrier (header for server function calls, something the page load can carry for
  reloads) is left to the plan. Requirements: Obnovit and in-app full reloads keep the frame logged
  in; nothing changes for requests without it. A token in a preview URL or preview proxy log is
  acceptable: previews hold only demo data and demo sessions **[call]**. Production never sees one.

### The page `/dev/multi`
- Guarded like `/dev/ui` (not found outside preview/dev).
- Frames are same-origin iframes of the app at its real routes.
- Layout and each frame's token kept in the browser's local storage (per viewer, may be empty;
  then frames log in again).
- Obnovit reloads that frame's iframe at its current address. Obnovit vše does all.
- The address field shows the iframe's current path and navigates it on Enter.
- Changing a frame's user logs the new user in for that frame (a new session).
- Tablet frames are shown scaled (70 % in the wireframe) so they fit a monitor **[call: wireframe
  agent]**.
- UI labels in Czech via `src/lib/strings.ts`.

### Known gap
A put-down phone is not "visible"; picking it up tells the app it is visible again. On the page
every frame is visible all the time. Today the app uses that signal only for the service worker
update check (`src/pwa/register.ts`), not for data, so data behaviour is unaffected; that check
just won't fire on "pick-up".

## Spec change

This doc's spec PR (docs only, Jakub merges) also adds the bullet to the main spec, so the build PRs
change no spec. §6 gets one bullet: on dev and PR previews only, `/dev/multi` shows several demo users side by side;
each frame logs in with the demo password and carries its own session token in place of the
cookie; production ignores frame tokens and has no such page.

## Left to the builder

- Token carrier mechanics and how the client adds it (TanStack Start function middleware or
  similar).
- PR split (suggested: 1. frame login + token carrier with guards and tests; 2. the page and its
  e2e test).
- Seed: the `demo` seed already has all four users; the e2e suite for the page gets its own row in
  `e2e/suites.ts`.
- Exact sizes, icons and layout details within the wireframe.
