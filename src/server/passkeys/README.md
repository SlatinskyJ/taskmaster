# Passkeys

WebAuthn passkeys (spec §11 Passkeys, #29): Face ID, Touch ID, a fingerprint or the phone's PIN
instead of a password. Built on `@simplewebauthn/server`. Password login stays as the fallback.

- `config.ts`: on only when `WEBAUTHN_RP_ID` is set (production: its own host). Previews leave it
  unset, so they offer password login only. A bad value stops the server at boot.
- `challenges.ts`: challenges live in `passkey_challenges`, used once, 5 minutes. Login
  challenges are capped per client IP (IPv6 by /64) and in total; registration ones per user.
- `http.ts`: the challenge cookie `__Host-tm_pk_challenge` (HttpOnly, Secure, SameSite=Strict).
- `register.ts`: options for a signed-in user (discoverable credential, user verification
  required, pinned algorithms), then verify and store. `PasskeySummary` is the only shape that
  leaves the server.
- `login.ts`: usernameless login. Opens a normal session with method `passkey`. Failures are
  audit-logged like password ones; a known passkey's failures count in the login rate limit.
- `manage.ts`: list, remove your own, the admin removes all of a user's.
- `handlers.ts` / `functions.ts`: the server functions. Screens import only `functions`.

## The flow

1. The browser calls `passkeyLoginOptionsFn` (or `passkeyRegisterOptionsFn`): a challenge row is
   stored, its token goes to the cookie, the options go back as JSON text.
2. The browser runs the ceremony (`@simplewebauthn/browser`) and sends the answer to
   `passkeyLoginFn` (or `passkeyRegisterFn`).
3. The server uses the challenge up, verifies origin, RP ID, challenge, user verification and
   signature, and writes the change with its audit entry in one transaction.

## Config

- `WEBAUTHN_RP_ID`: the host passkeys are bound to, e.g. `taskmaster.example.cz`.
- `WEBAUTHN_ORIGIN` (optional): the exact origin when it is not `https://<WEBAUTHN_RP_ID>`, e.g.
  with a port. `http://` is allowed only for `localhost`.

A passkey made under one RP ID never works under another, so passkeys made on a test host don't
carry over to production.

## Screens

- `src/lib/passkeys.ts`: the browser side. Runs the ceremony and hands screens a plain outcome
  (`cancelled` stays quiet). `createLoginFlow` keeps one ceremony at a time on the login screen.
- `/login`: the passkey button and the username field's autofill, only when passkeys are on and
  the browser can do them.
- `/klic`: after a password login without a passkey, the offer ("Nastavit" / "Teď ne"). No
  bottom bar. Asks again at the next password login.
- `/profil`: your passkeys (device, added, last used), add this device, remove behind a confirm.
- `/sprava`: the admin sees each person's count and removes all of a person's passkeys.

The server bundle leaves `@simplewebauthn/server` unbundled (`traceDeps` in `vite.config.ts`):
bundled, its `reflect-metadata` import ran too late and the login screen failed to load.

## Trying it locally

`pnpm build`, then
`WEBAUTHN_RP_ID=localhost WEBAUTHN_ORIGIN=http://localhost:3000 TASKMASTER_ENV=preview node .output/server/index.mjs`
and open `http://localhost:3000` (demo users, password `demo1234`).

`pnpm e2e` runs the browser tests (`e2e/`) against the built server: passkeys on, with Chromium's
virtual authenticator, and off. Without Playwright's own Chromium, set `PW_CHROMIUM_PATH`.
