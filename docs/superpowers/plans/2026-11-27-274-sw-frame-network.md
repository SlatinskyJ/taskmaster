# Service worker leaves frame page loads to the browser: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#274 A viewer frame reads the page's login when the service worker refetches a page](https://github.com/SlatinskyJ/taskmaster/issues/274), Jakub's decision 2026-11-27: option A.

**Goal:** A page load inside an `<iframe>` never goes through the service worker, so the browser sends `Sec-Fetch-Dest: iframe` itself and the server treats it as a frame (never the page's cookie).

**Architecture:** `strategyFor` in `src/pwa/policy.ts` (pure, unit-tested) gets the request's `destination`; `destination === 'iframe'` returns `network`, which `src/pwa/sw.ts` already treats as "don't call `respondWith`". No change to `sw.ts`, the server or the frame code. The e2e loop test in `frames.spec.ts` then runs with the service worker on, and a new e2e case pins the bug.

**Tech Stack:** TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §6 "Multi-user viewer" and §11 (PWA [call]); design `docs/superpowers/specs/2026-11-26-multi-user-viewer-design.md` "Carrying the token" ("A frame request never falls back to the page's cookie").

**Size:** about 10 changed lines outside tests (`policy.ts`). Tests: about 15 lines in `policy.test.ts` and `sw.test.ts`, about 25 in `e2e/frames.spec.ts`.

## Global Constraints

- Service worker policy stays an allowlist: only hashed `/assets/` and `SHELL_FILES` are cached; HTML is never cached (`policy.ts` header).
- `sw.js` stays a classic script with no imports (`sw.test.ts` "bundles into one classic script").
- Frames exist only in dev and previews (`devPagesAllowed`); production behaviour for top-level pages must not change.
- Code, identifiers and commits in English; no Czech UI text changes.
- Never weaken a test. The `serviceWorkers: 'block'` in `frames.spec.ts` goes only because the case passes with the worker on.

## Review Focus

- A top-level navigation (`destination: 'document'`) must still get `navigation` (network with the offline page): pinned in Task 1.
- An iframe load from another origin stays `network` as before (order of checks does not matter for it): pinned in Task 1.
- A frame load while offline now gets the browser's own error page, not the app's offline page. Accepted cost (Jakub, issue comment); no test, stated in the brief.
- Browsers or test fakes with no `destination` (older engines, the `navigate()` fake in `sw.test.ts`) must behave as today: `destination` is optional in `RequestLike`, and a missing value is treated like `document`. Pinned in Task 1.
- The worker must already control the page when the frame loads, or the e2e case proves nothing: Task 2 waits for `navigator.serviceWorker.controller` before adding the frame.

---

### Task 1: `strategyFor` leaves iframe loads to the browser

**Files:**
- Modify: `src/pwa/policy.ts` (`RequestLike`, `strategyFor`, the `Strategy` doc comment)
- Test: `src/pwa/policy.test.ts`, `src/pwa/sw.test.ts`

**Interfaces:**
- Produces: `RequestLike` gains `destination?: string` (a real `Request` has it, so `sw.ts` passes `event.request` unchanged). `strategyFor(request, origin)` returns `'network'` when `request.destination === 'iframe'`, checked before the `mode === 'navigate'` branch (a frame's page load also has `mode: 'navigate'`).

- [ ] **Step 1: Write the failing tests** in `policy.test.ts`, `describe('strategyFor')`:

```ts
it('leaves a frame’s page load to the browser, so it says Sec-Fetch-Dest: iframe (#274)', () => {
  expect(strategyFor({ ...get('/login', 'navigate'), destination: 'iframe' }, origin)).toBe('network')
  expect(strategyFor({ ...get('/?tmFrame=x', 'navigate'), destination: 'iframe' }, origin)).toBe('network')
})

it('still serves top-level page loads, with or without a destination', () => {
  expect(strategyFor({ ...get('/', 'navigate'), destination: 'document' }, origin)).toBe('navigation')
  expect(strategyFor(get('/', 'navigate'), origin)).toBe('navigation')
})
```

And in `sw.test.ts`, `describe('service worker')`, through the real worker bundle:

```ts
it('does not answer a frame’s page load (#274)', async () => {
  const { dispatch } = startWorker('v1', new FakeCaches())
  const frameLoad = { ...navigate('/login'), destination: 'iframe' } as Request
  expect(await dispatch('fetch', frameLoad)).toBeUndefined()
})
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run src/pwa/policy.test.ts src/pwa/sw.test.ts`
Expected: the two #274 cases FAIL (`'navigation'` / a response); the top-level case passes.

- [ ] **Step 3: Implement** in `policy.ts`: add `destination?: string` to `RequestLike`; in `strategyFor`, after the origin check and before `mode === 'navigate'`, return `'network'` for `request.destination === 'iframe'`. Extend the `network` line of the `Strategy` comment: "also a page load inside a frame: the browser then sends `Sec-Fetch-Dest: iframe`, which the server needs to tell a frame from the page (#274)".

- [ ] **Step 4: Run and see them pass**

Run: `pnpm exec vitest run src/pwa/`
Expected: all PASS.

- [ ] **Step 5: Commit** `policy.ts`, `policy.test.ts`, `sw.test.ts`: "Leave frame page loads to the browser in the service worker".

### Task 2: e2e with the service worker on

**Files:**
- Modify: `e2e/frames.spec.ts` (the `describe('without the service worker')` block and one new case)

**Interfaces:**
- Consumes: Task 1's behaviour through the built `sw.js` (`pnpm build`). Helpers already in the file: `signedInAsTata`, `addFrame`-style frame creation, `frameLogin`, `openInFrame`, `countFrameLoads`.

- [ ] **Step 1: Write the new case** (top level of `frames.spec.ts`, service worker allowed, which is Playwright's default):

```ts
test('with the service worker in control, a frame opened without tmFrame shows login, never the page’s user (#274)', async ({ page }) => {
  await signedInAsTata(page)
  // The worker must control the page, or its fetch handler never sees the frame's load.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  // A frame of the viewer's kind, opened at /login with no tmFrame (the issue's case).
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.id = 'viewer'
    frame.name = 'tm-frame:'
    frame.src = '/login'
    document.body.prepend(frame)
  })
  const frame = page.frameLocator('#viewer')
  await expect(frame.getByLabel(cs.login.username)).toBeVisible()
  await page.waitForTimeout(1000)
  await expect(frame.getByRole('heading', { name: hello('Táta') })).toHaveCount(0)
})
```

If `controller` stays null after the first load (the worker claims clients on activate, `sw.ts`), the step reloads the page once after `navigator.serviceWorker.ready` and waits again; the plan does not change the app's registration for this.

- [ ] **Step 2: Prove it catches the bug**: with Task 1's `policy.ts` change reverted locally, `pnpm build && pnpm exec playwright test --project frames -g '#274'` must FAIL (the frame shows Táta's Domů). Restore the change.

- [ ] **Step 3: Drop the block**: remove `test.describe('without the service worker')`, its comment and `test.use({ serviceWorkers: 'block' })`; keep its test 'a redirect that keeps dropping tmFrame cannot reload-loop the frame' unchanged at top level. Add a `page.waitForFunction(() => navigator.serviceWorker.controller !== null)` after `signedInAsTata` in it, so it really runs with the worker on.

- [ ] **Step 4: Run**

Run: `pnpm build && pnpm exec playwright test --project frames --repeat-each 3`
Expected: all PASS (`frames` is its own server; its tests log in and out but do not depend on order).

- [ ] **Step 5: Full check and commit**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`, then the full `pnpm e2e` once.
Commit `e2e/frames.spec.ts`: "Run the frame tests with the service worker on".
