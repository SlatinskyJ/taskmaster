# Change my own password on Profil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#210 Change my own password on Profil](https://github.com/SlatinskyJ/taskmaster/issues/210) (epic #204).

**Goal:** A signed-in person changes their own password on Profil (current password, new one twice), and by default logs out their other sessions.

**Architecture:** A framework-free auth function `changeOwnPassword` (beside `login` in `src/server/auth/`) reuses the login rate limit and argon2 helpers, and writes the hash through a new `users/manage` writer in one transaction with its audit entry. A guarded server function wraps it behind a new launch switch `passwordChange` (off in prod). Profil gets a "Změnit heslo" row that opens a vaul bottom sheet with the form.

**Tech Stack:** TanStack Start server fns, Drizzle/SQLite, argon2 (existing `hashPassword`/`verifyPassword`), React + vaul `Drawer`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §6 (accounts), §11 Auth.

**Size:** about 300 changed lines outside tests and the migration (spec 1, server ~110, switch ~10, sheet + Profil ~150, strings ~20). One PR.

## Decided (Jakub)

- 2026-11-22 demo: "There is no way for a user to change their own password." — the OK for the spec line.
- 2026-11-24: a checkbox "log out other sessions", **ticked by default**. This session always stays.
- From the issue: 8 to 256 characters (same as the admin's starting password, `MIN_USER_PASSWORD`, `MAX_PASSWORD_LENGTH`); a wrong current password counts toward the login rate limit; audit entry with no password in it; the admin's reset on Správa stays as it is; launch switch, off in prod.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`.
- Every state change writes its audit entry in the same transaction. Audit keys containing "password" are redacted: use `hashChanged`, `sessionsEnded`, `othersLoggedOut`.
- Every server fn has `requireUser`/`requireRole` (pinned in `tests/server-fn-guards.test.ts`).
- Forms: the focused field is visible with the phone keyboard open; a case in `e2e/keyboard.spec.ts`. Forms go in the bottom sheet (vaul `Drawer`), which moves above the keyboard.
- New launch switch: key in `src/lib/features.ts`, a seed row **off** in a new migration. If #227 (`settleLastDay`, 0027) merges first, this migration takes the next number (regenerate; never edit a committed one).

## Review Focus

1. **Rate limit shared with login:** 10 wrong current passwords in 15 min → the 11th change is refused `rate_limited` without checking, *and* a login for that username is refused too. Same keys (`limitKeys(username, ip)`).
2. **Race:** the hash changes between verify (async) and write (an admin reset or a second tab) → refused, nothing written (like `login`'s re-read).
3. **Sessions:** with the box ticked, every other session of the user ends and this one stays; unticked, all stay; other users' sessions never touched.
4. **Lengths:** new password 7 → refused, 8 → ok, 256 → ok, 257 → refused; a current password over 256 is a wrong password (never hashed).
5. **Switch off:** the server fn refuses (`feature_off`) and Profil shows no entry.

---

### Task 1: Spec §6

**Files:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §6.

- [ ] **Step 1:** After the "A password reset sets…" bullet add: "**Changing your own password** (Jakub, 2026-11-22/24): on Profil anyone signed in enters the current password and the new one twice (same length rules as the admin's starting password). A wrong current password counts toward the login rate limit. A checkbox, ticked by default, logs out every other session; this one stays. Audit-logged. The admin's reset stays for forgotten passwords."
- [ ] **Step 2:** Commit.

### Task 2: Writer in `users/manage`

**Files:** `src/server/users/manage.ts`, `src/server/users/index.ts`, test `src/server/users/manage.test.ts`.

**Produces:** `setOwnPasswordHash(tx: Tx, userId: number, expectedHash: string, passwordHash: string, keepSessionId: number | null, now: Date): Result<{ sessionsEnded: number }, 'not_found' | 'changed' | 'invalid_hash'>` — inside the caller's transaction: row missing → `not_found`; `row.passwordHash !== expectedHash` → `changed`; updates hash + `updatedAt`; when `keepSessionId !== null` deletes the user's sessions with `id <> keepSessionId` (else none); writes `user.updated` with actor `{kind:'user', userId}`, `before: auditView(row)`, `after: {...auditView(updated), hashChanged: true, sessionsEnded}`.
  (Naming: `keepSessionId` null = "log nobody out". The caller passes the current session id only when the box is ticked.)

- [ ] **Step 1: Failing tests:** updates the hash; ends only the user's other sessions (two sessions of the user + one of another user → 1 ended, the kept one and the other user's remain); `null` ends none; `changed` writes nothing; audit `after` has no key matching /password/i and no hash; `failAuditOn` → the hash and sessions roll back.
- [ ] **Step 2–4:** fail → implement (add `endOtherSessions(tx, userId, keepId): number` beside `endUserSessions` in `sessions.ts`) → pass. Commit.

### Task 3: `changeOwnPassword`

**Files:** create `src/server/auth/changePassword.ts`, test `src/server/auth/changePassword.test.ts`, export from `src/server/auth/index.ts`.

**Interfaces:**
```ts
export type ChangePasswordError = 'invalid_password' | 'wrong_password' | 'rate_limited' | 'changed'
export interface ChangePasswordInput {
  userId: number
  /** The session making the request; it always stays. */
  sessionId: number
  current: string
  next: string
  logOutOthers: boolean
  ip: string
}
export async function changeOwnPassword(db: Db, input: ChangePasswordInput, now?: Date): Promise<Result<{ sessionsEnded: number }, ChangePasswordError>>
```
Order: (1) `next` length outside 8..256 → `invalid_password` (not counted, nothing written); (2) load the user (missing → `wrong_password`); (3) `reserveAttempt(db, limitKeys(user.username, input.ip), now)` null → `rate_limited`; (4) `current.length > MAX_PASSWORD_LENGTH` or `!verifyPassword` → audit `auth.password_change_failed` (actor user, entity user, `after: { ip }`) in its own transaction, return `wrong_password` (the attempt stays counted); (5) `hashPassword(next)`; (6) one transaction: `releaseAttempt`, `setOwnPasswordHash(tx, userId, verifiedHash, newHash, logOutOthers ? sessionId : null, now)`; `changed` → return it (attempt released: the password was right).

- [ ] **Step 1: Failing tests** (`createTestDb`, demo-like user with password `demo1234`, two sessions):
  - success, box ticked: new password logs in (`login`), old one doesn't; other session gone, this one stays; `sessionsEnded: 1`.
  - success, box unticked: both sessions stay.
  - wrong current → `wrong_password`, hash unchanged, one `auth.password_change_failed` row, login-failure rows for the user key + ip.
  - rate limit: 10 wrong changes → 11th `rate_limited` even with the right password, and `login` for that user → `rate_limited`; boundary 9 wrong → 10th with right password succeeds.
  - lengths 7/8/256/257 for `next`; `current` of 257 chars → `wrong_password` without hashing.
  - race: admin `resetPassword` between verify and write (stub `hashPassword` delay or call `setOwnPasswordHash` with a stale `expectedHash`) → `changed`, nothing written.
  - another user's session is never touched.
- [ ] **Step 2–4:** fail → implement → pass. Commit.

### Task 4: Switch `passwordChange` + server function

**Files:** `src/lib/features.ts` (key, `NO_FEATURES`, `ALL_FEATURES`), new migration (`INSERT … ('passwordChange', 0)`, comment "off until Jakub turns it on"), `src/server/features/README.md`, `flags.test.ts`; `src/server/auth/functions.ts` (+ test `src/server/auth/functions.test.ts` or the existing http/fn test file); `tests/server-fn-guards.test.ts`; seeds `src/server/demo/seeds.ts` (new seed `password: { pieces: [], features: ['passwordChange'] }`; `demo` gets it via `FEATURE_KEYS`).

**Produces:**
- `parseChangePassword(data: unknown): { current: string; next: string; logOutOthers: boolean }` — strings and a boolean, else throws `Invalid input`.
- `changePasswordFn` POST, `.middleware([requireUser])`, `.validator(parseChangePassword)`; handler: switch off → `{ ok: false, error: 'feature_off' }`; current session from `sessionToken()` + `findSession` (missing → `{ ok:false, error:'wrong_password' }` is wrong — use `requireUser` context and look up the session; if none, throw `Unauthorized` like the guard); calls `changeOwnPassword` with `clientIp()`; returns `{ ok: true; sessionsEnded: number } | { ok: false; error: ChangePasswordError | 'feature_off' }` and nothing else (pin the shape: no hash, no user row).

- [ ] **Step 1: Failing tests:** `parseChangePassword` rejects non-strings, missing `logOutOthers`, extra types; guards test lists `changePasswordFn` as `requireUser`; flags test reads `passwordChange: false` after migrations.
- [ ] **Step 2–4:** fail → implement → pass; `pnpm db:check`. Commit.

### Task 5: Profil → Změnit heslo sheet

**Files:** create `src/components/auth/ChangePasswordDrawer.tsx` (+ `changePassword.test.tsx`), modify `src/routes/_app/profil.tsx`, `src/lib/strings.ts` (`cs.profile.password*`).

Copy (`cs.profile`):
- `passwordRow: 'Změnit heslo'` (row button on Profil, under Passkeys / before Odhlásit)
- `passwordTitle: 'Změnit heslo'`, `currentPassword: 'Současné heslo'`, `newPassword: 'Nové heslo'`, `newPasswordAgain: 'Nové heslo znovu'`
- `passwordHint: (min) => \`Aspoň ${min} znaků.\`` (reuse `cs.admin.startPasswordHint` if it reads the same)
- `logOutOthers: 'Odhlásit na ostatních zařízeních'`
- `passwordSubmit: 'Změnit heslo'`, `passwordSaving: 'Ukládám…'`
- errors: `passwordMismatch: 'Nová hesla se neshodují.'`, `passwordWrong: 'Současné heslo nesedí.'`, `passwordTooShort: (min) => …`, rate limited → `cs.login.rateLimited`, `changed` → `'Heslo se mezitím změnilo. Zkus to znovu.'`, network → `cs.login.failed`
- toast: `passwordChanged: 'Heslo je změněné.'`

Behaviour:
- Profil shows the row only when `context.features.passwordChange`. Row = `Card` button, `min-h-tap`, full width.
- Sheet (vaul `Drawer`, like `PersonDrawer`): three `Input type="password"` fields with `autoComplete` `current-password` / `new-password` / `new-password`, `maxLength={MAX_PASSWORD_LENGTH}`, labels bound; a native checkbox (pattern of `RecurringFields`) in a `<label>` row `min-h-tap`, **checked by default**; submit button full width in `DrawerFooter`.
- Client checks before sending: both new fields equal (else mismatch error, nothing sent), length ≥ 8 (else hint as error).
- Busy: submit disabled + "Ukládám…"; error under the fields in `role="alert"`, fields keep their values except on success; success → toast, sheet closes, fields cleared. Server errors map to the copy above; a thrown call → `cs.login.failed`, user can resend.
- No animation of our own (vaul has its own; `motion-reduce` already handled in `drawer.tsx` — check, add if missing).
- 360 px: labels and checkbox text wrap; nothing is cut.

- [ ] **Step 1: Failing component tests** (render the drawer open with a fake `onSubmit`): checkbox checked by default and sends `logOutOthers: true`; unticked sends `false`; mismatch shows the error and does not call `onSubmit`; 7-char new password blocked; each server error shows its Czech text; busy label while pending; success clears fields and calls `onDone`. Profil: row hidden with the switch off, shown with it on.
- [ ] **Step 2–4:** fail → implement → pass. Commit.

### Task 6: e2e

**Files:** `e2e/password.spec.ts` (new suite row `{ name: 'password', spec: 'password.spec.ts', seed: 'password' }` in `e2e/suites.ts`), `e2e/keyboard.spec.ts` (new case; the `keyboard` suite seed gets `passwordChange` — or the keyboard case uses a suite whose seed has it: add `'passwordChange'` to the `tasks` seed's features only if no `tasks` test depends on it off; else give the keyboard case its own row `keyboard-password` on seed `password`).

- [ ] `password.spec.ts`: Starší logs in on two browser contexts; in context A changes `demo1234` → `noveheslo1` with the box ticked; toast shows; context B reloads → on `/login`; context A still signed in; logout and login with the new password works, the old one fails.
- [ ] keyboard case: open the sheet, `openKeyboard` + `expectAboveKeyboard` for each of the three fields.
- [ ] `pnpm e2e` for these suites passes.
- [ ] Commit.

### Task 7: Verify, screenshots, cleanup

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm db:check`.
- [ ] Screenshots (UX 360×800 light; brief 393×852 @3x): Profil with the row; the sheet empty; each error; busy; keyboard open on each field (`profil-starsi-keyboard-<field>.png`).
- [ ] Delete this plan in its own commit, brief, mark ready, `preview` label.
