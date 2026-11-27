# Auth

Password login, sessions and the login rate limit (spec §6, §11 Auth). Role guards (#28) and
passkeys ([`src/server/passkeys`](../passkeys/README.md)) build on this.

- `login.ts`: `login()` / `logout()`. Each writes its audit entry in the same transaction.
- `sessions.ts`: random 256-bit token in the cookie, SHA-256 in `sessions`. ~90-day sliding
  expiry, renewed at most once a day. `endUserSessions()` runs on a password reset.
- `rateLimit.ts`: failed logins per username and per IP in the last 15 minutes (`login_failures`);
  on the public demo also every attempt per IP (below).
- `http.ts`: the cookie (`__Host-tm_session`, HttpOnly, Secure, SameSite=Lax) and the client IP.
  `currentUser()` is the one way server code learns who is signed in.
- `frame.ts`, `frameLogin.ts`: viewer frames on dev, previews and the demo (below).
- `functions.ts`: server functions `loginFn`, `logoutFn`, `getCurrentUserFn`, `frameLoginFn`.
- `authorize.ts`: the one role check (`authorize`) and each role's landing page.
- `guards.ts`: `requireUser` / `requireRole(...)` middlewares for server functions.

## Guarding a server function

Every server function takes a guard, or is listed in `PUBLIC_SERVER_FNS` with its file and a reason.
`tests/server-fn-guards.test.ts` scans `src/` and fails otherwise; it also pins each function's
roles, so add yours there.

```ts
export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(({ context }) => /* context.user is the caller */)
```

Screens behind login live under `src/routes/_app/`: its `beforeLoad` sends anyone not signed
in to `/login?redirect=…`. A route guard only hides a screen; the server function's guard is
what protects the data.

## Config

- `TRUST_PROXY=1`: behind a reverse proxy, take the client IP from the last `X-Forwarded-For`
  entry. Without it every request looks like it comes from the proxy, and the per-IP limit
  then counts the whole family's failures together. Set it wherever the app sits behind a proxy.
- `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`: passkeys, see [`src/server/passkeys`](../passkeys/README.md).
- `TASKMASTER_ENV=demo`: the public demo (next section).

## The public demo

`TASKMASTER_ENV=demo` with no `ADMIN_PASSWORD` (`isDemo`, `src/server/env/demo.ts`; with
`ADMIN_PASSWORD` set it turns nothing on) runs a server anyone may try: the demo seed and dev pages
as on a preview, plus:

- **Lock** (`src/server/demo/lock.ts`): `demoLock`, listed after the role guard, refuses with 403
  `demo_locked` the server functions in `DEMO_LOCKED_FNS` (people, passwords, launch switches).
  `tests/server-fn-guards.test.ts` pins the list against the code. A refusal changes nothing, so
  it writes no audit entry.
- **No links** (`src/server/demo/links.ts`): a function middleware registered first in
  `src/start.ts` removes every `http://`, `https://` or `www.` run up to the next whitespace from
  every string a server function receives, before the function's own validator.
- **Passkeys off**, whatever `WEBAUTHN_RP_ID` says.
- **Login limits**: the demo family's names skip the per-username limit (one visitor's typos must
  not lock them for the next); instead each IP gets `DEMO_ATTEMPTS_PER_IP` attempts, right or
  wrong, per 15 minutes (key `demo-ip:<ip>`). The per-IP failure limit stays.
- **Live streams**: at most `DEMO_STREAMS_PER_IP` open per IP (`src/server/demo/caps.ts`, in
  memory); the next gets 429.
- It needs `TRUST_PROXY=1` (the caps must see the visitor): without it the server won't boot.

## Viewer frames (dev, previews and the demo)

The multi-user viewer (`/dev/multi`, spec "Multi-user viewer") shows several people at once, one
per iframe, so a frame can't use the shared cookie. Only where `devPagesAllowed` holds (dev, PR
previews, the demo), `frame.ts` marks a request as a frame by the `x-tm-frame` header (server function
calls), the `tmFrame` query (document loads) or `Sec-Fetch-Dest: iframe`; the value is the frame's
session token, or `-` for none. In a frame:

- the cookie is never read, set or cleared, also with no token or a dead one (nobody signed in);
- logging in (password, passkey, or the viewer's `frameLoginFn`) returns the token as
  `frameToken` instead of setting the cookie; logging out ends only that frame's session;
- the sessions are ordinary ones: same table, expiry, audit.

A frame's page load that the server redirects (`/` → `/sprava`, `/login` → landing) keeps its
`tmFrame` query on the new address when it stays on the site (`frameRedirect.ts`, a request
middleware in `src/start.ts`), so the frame arrives logged in. On the client, a frame loaded
without its token re-enters the same address with it at most once per 5 s (`src/lib/frame.ts`
`guardedReentryUrl`), so a redirect that still drops the query can't become a reload loop.

The client (`src/lib/frame.ts`, `src/start.ts`) keeps the token in the frame's `window.name`
(`tm-frame:<token>`) and sends it on every server function call. In production every frame
signal is ignored and `frameLoginFn` answers `not_available`, as it does when `ADMIN_PASSWORD`
is set.

## CSRF

Server functions are protected by the session cookie's `SameSite=Lax` plus TanStack Start's
CSRF middleware (checks `Origin` / `Sec-Fetch-Site`). `src/start.ts` registers it with
`createCsrfMiddleware()`, since a custom `src/start.ts` replaces the default; keep it there.
`e2e/frames.spec.ts` checks a cross-site call is refused.

## Adding a login method

The tablet name+PIN mode and passkeys open sessions on the same table: add the method to
`SESSION_METHODS` and call `createSession(tx, userId, '<method>', now)` with an audit entry.
