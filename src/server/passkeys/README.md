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

- `WEBAUTHN_RP_ID`: the host passkeys are bound to, e.g. `taskmaster.slatinsky.cz`.
- `WEBAUTHN_ORIGIN` (optional): the exact origin when it is not `https://<WEBAUTHN_RP_ID>`, e.g.
  with a port. `http://` is allowed only for `localhost`.

A passkey made under one RP ID never works under another, so passkeys made on a test host don't
carry over to production.
