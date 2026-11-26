# Keep a viewer frame logged in across server redirects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (CLAUDE.md PR flow). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On dev and PR previews, a viewer frame whose page load the server redirects (`/` → `/sprava` for the admin, `/login` → landing for anyone signed in) arrives at the new address still carrying `tmFrame=<token>`, so it stays logged in and never reload-loops.

**Architecture:** A pure helper `frameRedirectLocation` in `src/server/auth/frame.ts` decides the new `Location` from the request's frame signals, the request URL and the old `Location`. A server request middleware `frameRedirectMiddleware` (new file `src/server/auth/frameRedirect.ts`, registered in `src/start.ts`) runs it on every page response that is a 3xx with a `Location` and rewrites the header in place. The client's `frameReentryUrl` gets a guard: the same address is re-entered at most once in a short window per frame, so a redirect we do not cover can never become an endless loop again.

**Tech Stack:** TanStack Start 1.169 request middleware (`createMiddleware().server`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-multi-user-viewer-design.md` ("Frame login": every request from a frame carries the frame's token; only when `devPagesAllowed`; a frame always says it is a frame) and `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §6 "Multi-user viewer". Issue: [#272](https://github.com/SlatinskyJ/taskmaster/issues/272). Code from PR #267: `src/lib/frame.ts`, `src/server/auth/frame.ts`, `src/server/auth/http.ts`, `src/start.ts`, `src/routes/__root.tsx`, `src/server/auth/README.md`.

## Global Constraints

- Nothing changes where `devPagesAllowed(env)` is false (production): no header is read, no Location is touched. `readFrame` already returns `{ inFrame: false }` there; the helper checks it first.
- `tmFrame` is never added to a redirect that leaves the site: the Location, resolved against the request URL, must have the request URL's origin. `//evil.example`, `/\evil.example`, `https://evil.example/x`, `javascript:` → untouched.
- Only page requests (`handlerType === 'router'`). Server function calls carry `x-tm-frame` and their redirects travel as JSON for client navigation; they are not touched.
- Only when the frame signal came from the query (the `x-tm-frame` header is absent and `tmFrame` is present). The value copied is the query's raw value, including the no-token sentinel `-` (see Decisions).
- Names: `FRAME_QUERY` (`tmFrame`), `FRAME_HEADER` (`x-tm-frame`), `NO_TOKEN` (`-`), `FRAME_NAME_PREFIX` (`tm-frame:`) from `src/lib/frame.ts`; no new string literals for them.
- Identifiers, comments, commits in English. No UI text changes, so no `src/lib/strings.ts` change.
- About 60 lines outside tests.

## Decisions (for the judges)

1. **Where: a request middleware, not the router.** Read in `@tanstack/start-server-core@1.169.45` `createStartHandler.ts`: for a page request the router's redirect is resolved inside `executeRouter` (`router.resolveRedirect` sets `Location` to a path for same-origin targets, a full URL for off-site ones) and returned as the terminal's response. Request middleware wraps that terminal: `const result = await next()` gives `result.response`, the redirect `Response` (status 307, mutable headers, built with `new Response` in `router-core/src/redirect.ts`). `handleRedirectResponse` runs *after* the middleware and takes `redirect.headers.get('Location')` first, then copies it to `options.href`, so a header rewritten in place is what the browser gets. The router has no per-request hook for redirects; its `rewrite.output` would rewrite every href (links too, and on the client), which is far wider than this bug. One middleware also catches every redirect source at once (route guards, `/login`'s `beforeLoad`, future ones).
2. **Rewrite in place.** The middleware sets the header on `result.response` and returns `result`; it never builds a new `Response`, so `isRedirect(...)` still holds for Start's later redirect handling.
3. **Copy `-` too.** A no-token frame (`/login?tmFrame=-`) that is redirected would otherwise rely on `Sec-Fetch-Dest: iframe` alone to stay a frame. Copying the raw query value keeps the spec's "a frame always says it is a frame" without that header; it adds nothing a page load did not already carry.
4. **The client guard is needed.** With the server fix, the known loop ends. But the loop's shape (server drops the query → client re-adds it → server drops it) returns with any redirect the middleware does not see (a `Location` resolved only after the middleware, a new redirect path in a future TanStack version). A tight reload loop hangs the viewer and burns a preview slot. Guard: `frameReentryUrl` re-enters a given address at most once per `REENTRY_WINDOW_MS = 5000` per frame; the second time it returns null and the frame shows what the server sent (logged out), which is visible and debuggable. A time window, not "once forever", so a later service-worker reload of the same address still re-enters. Memory lives in `sessionStorage` (survives the reload, per tab), keyed by the frame's `window.name` so two frames in one tab don't share it; every access in try/catch, and no storage means no guard (today's behaviour).
5. **Same origin by the request URL.** Behind the preview proxy `request.url` may carry the internal origin, while the router writes same-origin redirects as paths, which resolve to the request's origin and match. An absolute Location naming the public host would then look off-site and stay untouched: the safe failure.

## Review Focus

1. **An off-site or protocol-relative Location** (`//evil.example/x`, `/\evil.example`, `https://evil.example/`, `javascript:alert(1)`) on a frame request → untouched; the token never leaves the site. (Task 1 unit tests.)
2. **Production with every frame signal present** → Location untouched. (Task 1.)
3. **A Location that already carries `tmFrame`** (another value or the same) → exactly one `tmFrame`, the request's value; the rest of the query and the hash kept (`/login?redirect=%2Fsprava#x`). (Task 1.)
4. **Two frames in one tab, each re-entering** → each frame's guard is its own (`sessionStorage` key includes `window.name`). (Task 3 unit test.)
5. **`sessionStorage` throws (private mode, blocked storage)** → re-entry still works as before, unguarded; no crash. (Task 3 unit test with a throwing storage.)

---

### Task 1: `frameRedirectLocation` (pure)

**Files:**
- Modify: `src/server/auth/frame.ts`
- Test: `src/server/auth/frame.test.ts`

**Interfaces:**
- Consumes: `readFrame(env, req: FrameSignals)`, `FrameSignals`, `FRAME_QUERY`.
- Produces: `export function frameRedirectLocation(env: NodeJS.ProcessEnv, req: FrameSignals, requestUrl: string, location: string): string | null` — the new Location, or null for "leave it as it is".

Rules: null unless `readFrame(env, req).inFrame` and `req.header === undefined` and `req.query !== undefined`. Resolve `new URL(location, requestUrl)`; null if its origin differs from `new URL(requestUrl).origin` (a throwing `new URL` → null). Set `FRAME_QUERY` to `req.query` (replacing any existing). Return `pathname + search + hash` (a path, as the router writes same-origin redirects; never `url.href`, because behind the preview proxy the request origin is the internal one). Null when the resolved `pathname` starts with `//` (e.g. Location `/.//evil.example` normalises to `//evil.example`, which a browser reads as another host).

- [ ] **Step 1: Write the failing tests** in a new `describe('frameRedirectLocation')`, with `PREVIEW`, `PROD`, `NONE` from the file and `REQ = 'http://localhost:3000/?tmFrame=tok'`:
  - same-origin path: `frameRedirectLocation(PREVIEW, { ...NONE, query: 'tok', fetchDest: 'iframe' }, REQ, '/sprava')` → `'/sprava?tmFrame=tok'`
  - keeps query and hash, replaces an old token: `'/login?redirect=%2Fsprava&tmFrame=old#x'` → `'/login?redirect=%2Fsprava&tmFrame=tok#x'`
  - same-origin absolute: `'http://localhost:3000/sprava'` → `'/sprava?tmFrame=tok'`
  - the no-token sentinel is copied: query `'-'` → `'/login?redirect=%2F&tmFrame=-'` for Location `'/login?redirect=%2F'`
  - off-site → null for each of `'https://evil.example/x'`, `'//evil.example/x'`, `'/\\evil.example/x'`, `'javascript:alert(1)'`, `'/.//evil.example'` (pathname normalises to `//evil.example`), `'/./\\evil.example'`, and the same host on another port or scheme: `'http://localhost:3001/x'`, `'https://localhost:3000/x'` (previews share one host, one port per PR)
  - production → null: `frameRedirectLocation(PROD, { header: undefined, query: 'tok', fetchDest: 'iframe' }, REQ, '/sprava')`
  - header-only frame request → null: `{ ...NONE, header: 'tok' }`; also header and query both present → null
  - not a frame / no query → null: `NONE`, and `{ ...NONE, fetchDest: 'iframe' }`

- [ ] **Step 2: Run** `pnpm test src/server/auth/frame.test.ts` — expected: FAIL, `frameRedirectLocation` is not exported.

- [ ] **Step 3: Implement** `frameRedirectLocation` in `src/server/auth/frame.ts` by the rules above (about 15 lines).

- [ ] **Step 4: Run** `pnpm test src/server/auth/frame.test.ts` — expected: PASS. Then `pnpm mutation --mutate src/server/auth/frame.ts` and add a test for any surviving mutant in the new function.

- [ ] **Step 5: Commit** `git add src/server/auth/frame.ts src/server/auth/frame.test.ts && git commit -m "Frame redirects: decide the Location that keeps tmFrame"`

### Task 2: The middleware, and the e2e for both redirects

**Files:**
- Create: `src/server/auth/frameRedirect.ts`
- Modify: `src/start.ts`, `src/server/auth/README.md` ("Viewer frames" section: one sentence on redirects keeping `tmFrame`, one on the client guard)
- Test: `e2e/frames.spec.ts`

**Interfaces:**
- Consumes: `frameRedirectLocation` (Task 1), `FRAME_HEADER`, `FRAME_QUERY`.
- Produces: `export const frameRedirectMiddleware` = `createMiddleware().server(async ({ request, handlerType, next }) => { … })` from `@tanstack/react-start`. After `const result = await next()`: if `handlerType === 'router'`, `result.response.status` is 300–399 and it has a `Location`, call `frameRedirectLocation(process.env, frameSignals((n) => request.headers.get(n) ?? undefined, new URL(request.url)), request.url, location)`. `frameSignals(getHeader, url): FrameSignals` is a new pure export in `src/server/auth/frame.ts` (one place that maps a request to frame signals); `requestFrame` in `http.ts` uses it too (`frameSignals(getRequestHeader, getRequestUrl())`), so the redirect decision and the session decision can't drift apart. Unit test: it maps the three signals and leaves absent ones `undefined`.; when it returns a string, `result.response.headers.set('Location', it)`. Always return `result`.
- `src/start.ts`: `requestMiddleware: [csrf, frameRedirectMiddleware]` (CSRF stays first). Update the file's top comment.

- [ ] **Step 1: Write the failing e2e tests** in `e2e/frames.spec.ts` (suite `frames`, seed `family`, which has `admin`):
  - Client guard through `__root.tsx`: `page.route` answers the frame's next `tmFrame` page load with a 307 to the same path without `tmFrame` (simulating a redirect the middleware doesn't see); the frame stops navigating within 5 s (count frame navigations ≤ 3) and shows the login screen.
  - Generalise `frameLogin(page)` to `frameLogin(page, username = 'starsi', heading = hello('Starší'))`; existing callers unchanged.
  - Helper `frameToken(page): Promise<string>` → reads `document.getElementById('viewer').contentWindow.name`, strips `tm-frame:`, expects 43 chars.
  - Helper `countFrameLoads(page): () => number` → counts `page.on('framenavigated')` events whose frame is the `#viewer` frame (`frame.name().startsWith('tm-frame:')`), from the moment it is called.
  - `test('an admin frame opened at / ends on Správa, logged in')`: `signedInAsTata`; `frameLogin(page, 'admin', cs.admin.title)` (heading role, name `cs.admin.title`); `token = await frameToken(page)`; `loads = countFrameLoads(page)`; set the iframe's `src` to `/?tmFrame=${token}`; expect the frame's heading `cs.admin.title` visible and its `contentWindow.location.href` to match `/\/sprava\?tmFrame=[A-Za-z0-9_-]{43}$/` (poll, as the existing re-entry test does); `await page.waitForTimeout(1000)`; `expect(loads()).toBeLessThanOrEqual(2)`. Then the page itself still shows `hello('Táta')` after `page.reload()`.
  - `test('a logged-in frame that opens /login lands on its landing page, logged in')`: `signedInAsTata`; `frameLogin(page)` (starsi); `loads = countFrameLoads(page)`; set `src` to `/login` (no query: covers re-entry then the redirect); expect `hello('Starší')` visible in the frame and its href to match `/\/\?tmFrame=[A-Za-z0-9_-]{43}$/`; after 1 s, `loads() <= 3` (the logged-out `/login`, the re-entered load, the redirect target counts once).

- [ ] **Step 2: Run** `pnpm build && pnpm e2e --project frames` — expected: both new tests FAIL (the frame ends logged out / keeps navigating). Record the observed loop in the commit message.

- [ ] **Step 3: Implement** `src/server/auth/frameRedirect.ts` and register it in `src/start.ts` as in Interfaces; update `src/server/auth/README.md`.

- [ ] **Step 4: Run** `pnpm build && pnpm e2e --project frames` — expected: all frames tests PASS, the three from #267 included. Then `pnpm typecheck && pnpm lint && pnpm test` — expected: clean; check the client bundle has no `frameRedirect` server code (`grep -r frameRedirectLocation .output/public` → no hits; if it is there, note it in the brief — the helper is pure, but say so).

- [ ] **Step 5: Commit** `git add src/server/auth/frameRedirect.ts src/start.ts src/server/auth/README.md e2e/frames.spec.ts && git commit -m "Keep tmFrame on a frame's same-origin page redirects"`

### Task 3: Client re-entry guard

**Files:**
- Modify: `src/lib/frame.ts`, `src/routes/__root.tsx`
- Test: `src/lib/frame.test.ts`

**Interfaces:**
- Consumes: existing `frameReentryUrl(win)`.
- Produces:
  - `export const REENTRY_WINDOW_MS = 5000`
  - `export type ReentryStore = Pick<Storage, 'getItem' | 'setItem'>`
  - `export function guardedReentryUrl(win: Named & { location: { href: string } }, store: ReentryStore | undefined, now: number): string | null` — `url = frameReentryUrl(win)`; null → null. Key `'tm.frameReentry:' + win.name`; stored value JSON `{ url: string; at: number }`. If the stored `url === url` and `now - at < REENTRY_WINDOW_MS` → null. Otherwise store `{ url, at: now }` and return `url`. Every store access in try/catch; a throw or unreadable JSON means "no memory" (return `url`).
  - `__root.tsx`: the effect calls `guardedReentryUrl(window, sessionStorageOrUndefined(), Date.now())`, where reading `window.sessionStorage` itself is inside try/catch (it can throw). `frameReentryUrl` stays exported and unchanged.

- [ ] **Step 1: Write the failing tests** (`describe('guardedReentryUrl')`, a `Map`-backed fake store, `at('tm-frame:abc', 'http://x/sprava')`):
  - first call at `now = 1000` → `'http://x/sprava?tmFrame=abc'`, and the store holds it
  - second call, same frame and address, at `1000 + 4999` → null
  - same address at `1000 + 5000` → the URL again (window passed). Run first, second and this call on ONE store in sequence (1000, 5999, 6000), so a guard that refreshes `at` on a refused call fails the 6000 case
  - another address in the same frame within the window → its URL
  - another frame (`tm-frame:def`) at the same address within the window → its URL (own key)
  - `store` undefined → the URL every time; a store whose `getItem`/`setItem` throw → the URL; `getItem` returning `'{'` → the URL
  - not a frame / no token → null without touching the store

- [ ] **Step 2: Run** `pnpm test src/lib/frame.test.ts` — expected: FAIL, `guardedReentryUrl` not exported.

- [ ] **Step 3: Implement** `guardedReentryUrl` in `src/lib/frame.ts` and switch `__root.tsx` to it. Update the `frameReentryUrl` doc comment's mention of the re-entry caller.

- [ ] **Step 4: Run** `pnpm test src/lib/frame.test.ts` then `pnpm build && pnpm e2e --project frames` — expected: PASS (the #267 re-entry test still re-enters once). `pnpm mutation --mutate src/lib/frame.ts`; cover survivors in the new function.

- [ ] **Step 5: Commit** `git add src/lib/frame.ts src/lib/frame.test.ts src/routes/__root.tsx && git commit -m "Re-enter a frame's address at most once per 5 s"`
