# Auth

Password login, sessions and the login rate limit (spec §6, §11 Auth). Passkeys (#29) and
role guards (#28) build on this.

- `login.ts`: `login()` / `logout()`. Each writes its audit entry in the same transaction.
- `sessions.ts`: random 256-bit token in the cookie, SHA-256 in `sessions`. ~90-day sliding
  expiry, renewed at most once a day. `endUserSessions()` runs on a password reset.
- `rateLimit.ts`: failed logins per username and per IP in the last 15 minutes (`login_failures`).
- `http.ts`: the cookie (`__Host-tm_session`, HttpOnly, Secure, SameSite=Lax) and the client IP.
  `currentUser()` is the one way server code learns who is signed in.
- `functions.ts`: server functions `loginFn`, `logoutFn`, `getCurrentUserFn`.

## Config

- `TRUST_PROXY=1`: behind a reverse proxy, take the client IP from the last `X-Forwarded-For`
  entry. Without it every request looks like it comes from the proxy, and the per-IP limit
  then counts the whole family's failures together. Set it wherever the app sits behind a proxy.

## CSRF

Server functions are protected by the session cookie's `SameSite=Lax` plus TanStack Start's
default CSRF middleware (checks `Origin` / `Sec-Fetch-Site`). That default applies only while
the app has no `src/start.ts`: whoever adds one must add `createCsrfMiddleware()` there.

## Adding a login method

The tablet name+PIN mode and passkeys open sessions on the same table: add the method to
`SESSION_METHODS` and call `createSession(tx, userId, '<method>', now)` with an audit entry.
