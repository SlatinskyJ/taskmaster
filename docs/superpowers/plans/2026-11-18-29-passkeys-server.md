# Passkeys, part 1: server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#29 Passkey enrolment and login](https://github.com/SlatinskyJ/taskmaster/issues/29), with Jakub's decisions in [this comment](https://github.com/SlatinskyJ/taskmaster/issues/29#issuecomment-6977795223).

**Goal:** WebAuthn passkeys on the server: register, log in (usernameless), list, remove own, admin removes a user's. Off unless `WEBAUTHN_RP_ID` is set.

**Architecture:** A new server module `src/server/passkeys/` beside `src/server/auth/`. Challenges live server-side in SQLite, single use, found by a random token in a short-lived `__Host-` cookie. A passkey login opens a normal session (`method: 'passkey'`) through the existing `createSession`. Every write goes through one transaction with its audit entry.

**Tech Stack:** `@simplewebauthn/server` 14.1, Drizzle + better-sqlite3, TanStack Start server functions, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §11 (Passkeys, Sessions, Auth), §6; UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.4 (screens come in part 2).

**Split (stack).** #29 is about 850 changed lines in total, over the 800 line mark, so it is two stacked PRs:

| PR | Branch | Holds | Size (no tests, migrations, generated) |
| --- | --- | --- | --- |
| this one | `29-passkeys-server` | schema, config, challenges, register / login / manage, server functions | about 420 |
| part 2 (own plan later) | `29-passkeys-screens` | `@simplewebauthn/browser`, login button + autofill, offer screen, profile list, admin removal on Správa, Czech strings, Jakub's phone test | about 420 |

This PR says `Part of #29`; part 2 says `Closes #29`. This PR is backend only: no `preview` label, no screenshots, no UX judge. It is a little over 400 because the server functions belong with the code they wrap (they are thin, and part 2 needs them all).

## Global Constraints

- Relying-party ID `taskmaster.slatinsky.cz` in production, from env `WEBAUTHN_RP_ID`, never hardcoded (spec §11, issue #29).
- Passkeys are off when `WEBAUTHN_RP_ID` is unset. Previews leave it unset (Jakub, 2026-11-18). Off = options functions answer `disabled`; listing and removing still work.
- User verification is always required (Face ID / fingerprint / phone PIN): `userVerification: 'required'` in options and `requireUserVerification: true` in every verify.
- Discoverable credentials: `residentKey: 'required'`; login options have an empty `allowCredentials`.
- Several passkeys per user. Registrations and removals are audit-logged (`passkey.registered`, `passkey.removed`, both already in `AUDIT_ACTIONS`; entity type `passkey` already exists).
- Password stays as a fallback. An admin password reset does not touch passkeys (Jakub, 2026-11-18). The admin may remove all passkeys of a user (Jakub, 2026-11-18).
- Every state change writes its audit entry in the same transaction (CLAUDE.md).
- The audit log redacts any key containing `credential`, `token`, `secret`: log `passkeyId` (our row id) and `deviceKind`, never the credential id, public key or user handle.
- UTC instants as ISO strings via `toIsoUtc` / `parseIsoUtc` (`src/domain/dates.ts`).
- No Czech text in this PR: the device is stored as a kind (`iphone`, …); part 2 maps kinds to labels in `src/lib/strings.ts`.
- Inactive users: no new handling (Jakub rule, 2026-11-17), except the one check every login keeps: a passkey login of an inactive user opens no session, like password login (`login.ts`).

## Review Focus

1. **A passkey the server no longer knows** (removed in the profile, made on a preview, made on another deployment): the login fails with `unknown_passkey`, logs `auth.login_failed`, opens no session. Part 2 tells the phone to forget it. Test in Task 5.
2. **The admin removes a passkey while its login is half done** (between the async verify and the write): no session opens. Test in Task 5.
3. **A replayed or stale challenge** (same cookie twice, older than 5 minutes, one user's registration challenge used by another user, a login challenge used to register): refused. Tests in Tasks 3 and 4.
4. **A flood of anonymous option requests** (each one stores a challenge): at most 20 live login challenges per client IP and 500 in total; registration challenges (signed-in only) are capped per user instead, so the anonymous flood can't block them. Expired ones are pruned on every issue. Tests in Task 3.
5. **A typo in `WEBAUTHN_RP_ID` or `WEBAUTHN_ORIGIN` in production** (scheme, port, path, uppercase, an origin on another host): the server refuses to boot with a clear message, instead of every registration failing later. Tests in Task 2.

## File Structure

- Create `src/server/db/schema/passkeys.ts`: tables `passkeys`, `passkey_challenges`. Export from `schema/index.ts`.
- Modify `src/server/db/schema/auth.ts`: `SESSION_METHODS = ['password', 'passkey']`.
- Create `drizzle/<n>_passkeys.sql` + snapshot (generated).
- Create `src/server/passkeys/config.ts`: env → config.
- Create `src/server/passkeys/challenges.ts`: issue / consume challenges.
- Create `src/server/passkeys/deviceKind.ts`: User-Agent → device kind.
- Create `src/server/passkeys/register.ts`, `login.ts`, `manage.ts`.
- Create `src/server/passkeys/http.ts`: the challenge cookie.
- Create `src/server/passkeys/handlers.ts` (the server-function bodies as plain functions, tested), `functions.ts` (thin `createServerFn` wrappers), `parse.ts`, `index.ts`, `README.md`.
- Modify `src/server/auth/guards.ts` (`PUBLIC_SERVER_FNS`), `tests/server-fn-guards.test.ts` (`EXPECTED_ROLES`).
- Modify `src/server/plugins/database.ts`: boot check + log line.
- Modify `src/server/auth/README.md`: link to the passkeys module, `WEBAUTHN_*` under Config.
- Create `tests/support/softAuthenticator.ts`: a software authenticator for tests.
- Tests: `src/server/passkeys/*.test.ts`.

---

### Task 1: Dependency, schema, migration

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/server/db/schema/passkeys.ts`
- Modify: `src/server/db/schema/index.ts`, `src/server/db/schema/auth.ts:8-9`
- Create: `drizzle/*_passkeys.sql`, `drizzle/meta/*` (generated)

**Interfaces:**
- Produces:
  - `passkeys` table, row type `PasskeyRow`. Columns: `id` integer PK autoincrement; `userId` → `users.id`, not null; `credentialId` text not null unique (base64url, as the browser sends it); `publicKey` blob (`mode: 'buffer'`) not null; `counter` integer not null; `transports` text (JSON array) nullable; `userHandle` text not null (base64url, same for all of one user's passkeys); `deviceKind` text enum `DEVICE_KINDS` not null, no CHECK (comment why, like `sessions.method`); `backedUp` integer boolean not null; `createdAt` text not null; `lastUsedAt` text nullable. Index `passkeys_user_idx` on `userId`.
  - `passkey_challenges` table, row type `PasskeyChallengeRow`. Columns: `id` integer PK autoincrement; `tokenHash` text not null unique (SHA-256 hex of the cookie token); `challenge` text not null (base64url); `purpose` text enum `CHALLENGE_PURPOSES = ['register', 'login'] as const` not null; `userId` → `users.id`, nullable (set for `register`); `userHandle` text nullable (set for `register`: the handle put in the options, stored with the new passkey); `ipKey` text nullable (set for `login`: SHA-256 hex of the client IP, never the IP itself); `expiresAt` text not null. Indexes on `expiresAt`, `ipKey`, `userId`.
  - `DEVICE_KINDS = ['iphone', 'ipad', 'android', 'mac', 'windows', 'linux', 'other'] as const`, `type DeviceKind`, exported from the schema file.
  - `SessionMethod` now includes `'passkey'`.

- [ ] **Step 1:** `pnpm add @simplewebauthn/server@^14.1.0`. Check it brings no native build (`pnpm why` shows only pure-JS `@peculiar/*`, `@levischuck/tiny-cbor`, `@hexagon/base64`).
- [ ] **Step 2:** Write `schema/passkeys.ts` as above, with a header comment like `schema/auth.ts` (what a row is, why only hashes / public keys are stored, rows are deleted on removal and the audit log keeps the history).
- [ ] **Step 3:** Add `'passkey'` to `SESSION_METHODS`; update the comment (tablet PIN still to come).
- [ ] **Step 4:** `pnpm db:generate --name passkeys`, then `pnpm db:check`. Expected: two `CREATE TABLE`, indexes, no change to `sessions` (its method column has no CHECK). PASS.
- [ ] **Step 5:** `pnpm typecheck && pnpm test`. PASS.
- [ ] **Step 6:** Commit `Add passkey tables and the simplewebauthn server dependency`.

### Task 2: Config

**Files:**
- Create: `src/server/passkeys/config.ts`, test `src/server/passkeys/config.test.ts`
- Modify: `src/server/plugins/database.ts`

**Interfaces:**
- Produces:
  - `interface PasskeyConfig { rpId: string; rpName: 'Taskmaster'; origin: string }`
  - `class PasskeyConfigError extends Error`
  - `passkeyConfig(env: NodeJS.ProcessEnv = process.env): PasskeyConfig | null`: null when `WEBAUTHN_RP_ID` is unset or empty; throws `PasskeyConfigError` when invalid.
  - `describePasskeys(config: PasskeyConfig | null): string`: the boot line.

Rules: RP ID must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$` (lowercase host, no scheme, port, path). Origin = `WEBAUTHN_ORIGIN` if set, else `https://<rpId>`. The origin must parse as a URL with no path other than `/`, no query; its hostname must equal the RP ID or end with `.<rpId>`; its protocol must be `https:`, except `http:` when the RP ID is `localhost` (browsers allow WebAuthn on http://localhost). The stored origin is `URL.origin` (scheme, host, port; no trailing slash), so `https://x.cz/` and `https://x.cz` give the same value.

- [ ] **Step 1: Write the failing tests** in `config.test.ts`:
  - `passkeyConfig({})` and `passkeyConfig({ WEBAUTHN_RP_ID: '' })` → `null`
  - `{ WEBAUTHN_RP_ID: 'taskmaster.slatinsky.cz' }` → `{ rpId: 'taskmaster.slatinsky.cz', rpName: 'Taskmaster', origin: 'https://taskmaster.slatinsky.cz' }`
  - `WEBAUTHN_ORIGIN: 'https://pc.example.ts.net:8443'` with RP ID `pc.example.ts.net` → origin kept with its port
  - `localhost` + `WEBAUTHN_ORIGIN: 'http://localhost:3000'` → ok
  - trailing slash: `WEBAUTHN_ORIGIN: 'https://taskmaster.slatinsky.cz/'` → origin `https://taskmaster.slatinsky.cz`
  - throws `PasskeyConfigError` for each RP ID: `https://taskmaster.slatinsky.cz`, `taskmaster.slatinsky.cz:443`, `taskmaster.slatinsky.cz/`, `Taskmaster.slatinsky.cz`
  - throws for origins: `http://taskmaster.slatinsky.cz` (not https), `https://evil.cz` (other host), `https://xtaskmaster.slatinsky.cz` (suffix without a dot), `https://taskmaster.slatinsky.cz/app` (path), `https://taskmaster.slatinsky.cz/?x=1` (query), `https://taskmaster.slatinsky.cz/#a` (fragment)
  - `describePasskeys(null)` contains `off`; with config, contains the RP ID and the origin.
- [ ] **Step 2:** `pnpm vitest run src/server/passkeys/config.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `config.ts`.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** In `plugins/database.ts`, after the DB is ready: `console.info(describePasskeys(passkeyConfig()))`. An invalid config throws there, so the server does not start (same as a failed migration). Lines: `[auth] passkeys off (WEBAUTHN_RP_ID not set)` / `[auth] passkeys on for <rpId> (origin <origin>)`.
- [ ] **Step 6:** Commit `Read the passkey relying party from WEBAUTHN_RP_ID`.

### Task 3: Challenges and the challenge cookie

**Files:**
- Create: `src/server/passkeys/challenges.ts`, `src/server/passkeys/http.ts`, tests `src/server/passkeys/challenges.test.ts`, `src/server/passkeys/http.test.ts`

**Interfaces:**
- Produces:
  - `CHALLENGE_TTL_MS = 5 * 60 * 1000`, `MAX_LOGIN_CHALLENGES_PER_IP = 20`, `MAX_LOGIN_CHALLENGES = 500`, `MAX_REGISTER_CHALLENGES_PER_USER = 5`
  - `type ChallengeFor = { purpose: 'login'; ip: string } | { purpose: 'register'; userId: number; userHandle: string }`
  - `issueChallenge(db: Db, issue: ChallengeFor, now: Date): { token: string; challenge: string } | null`: one transaction: delete rows with `expiresAt <= now`; for `login`, `null` when that IP has `MAX_LOGIN_CHALLENGES_PER_IP` live or all login rows reach `MAX_LOGIN_CHALLENGES`; for `register`, `null` when that user has `MAX_REGISTER_CHALLENGES_PER_USER` live (login rows don't count); else insert. `token` = 32 random bytes base64url (cookie only, stored via the existing `hashToken` from `~/server/auth/sessions`); `challenge` = 32 random bytes base64url (goes into the options). The IP is stored as `sha256(ipPrefix(ip))` hex, where `ipPrefix(ip: string): string` (exported) keeps an IPv4 address whole and cuts an IPv6 address to its /64 (one client usually holds a whole /64); an IPv4-mapped IPv6 (`::ffff:1.2.3.4`) counts as IPv4.
  - `consumeChallenge(db: Db | Tx, token: string, purpose: ChallengePurpose, now: Date): { challenge: string; userId: number | null; userHandle: string | null } | null`: finds the row by token hash and **deletes it whenever found** (single use, even when expired or the wrong purpose); returns null when unknown, `expiresAt <= now`, or the purpose differs. Rejects a token not shaped like 43 base64url characters without a query.
  - `http.ts`: `PASSKEY_CHALLENGE_COOKIE = '__Host-tm_pk_challenge'`; `setChallengeCookie(token: string): void` (HttpOnly, Secure, `SameSite=Strict`, path `/`, `maxAge` 300); `challengeToken(): string | undefined`; `clearChallengeCookie(): void`. Same style as `src/server/auth/http.ts`.

Removal of an expired challenge writes no audit entry: challenges are not state the audit log tracks (like `login_failures`). Say so in the file comment.

- [ ] **Step 1: Write the failing tests**:
  - issue then consume with the same purpose → `{ challenge, userId }`; the table is empty after
  - consume twice → second is `null`
  - consume with the other purpose → `null`, and the row is gone (no retry with the right purpose)
  - boundary: consumed at `now + CHALLENGE_TTL_MS - 1` → ok; at exactly `now + CHALLENGE_TTL_MS` → `null` and the row is gone
  - unknown token and a malformed token (`'x'`, 44 chars) → `null`
  - per-IP cap: IP A with 19 live → the 20th succeeds; with 20 live → `null`, while IP B still gets one
  - global login cap: 499 live (over many IPs) → the 500th succeeds; 500 live → `null`; 500 expired rows → issue succeeds and the expired rows are gone
  - register is outside the login caps: with 500 live login rows, a register challenge for tata still succeeds; tata's 6th live register challenge → `null`, starsi still gets one
  - the IP is not stored: no row holds the IP string
  - `ipPrefix`: `'10.0.0.2'` → `'10.0.0.2'`; `'2001:db8:1:2:aaaa::1'` and `'2001:db8:1:2:bbbb::9'` → the same value; `'2001:db8:1:3::1'` → a different one; `'::ffff:10.0.0.2'` → `'10.0.0.2'`; `'2001:db8::1'` and `'2001:db8::2'` → the same value (`::` expanded); `'2001:DB8::1'` → the same as `'2001:db8::1'`; two IPv6 addresses in one /64 share the per-IP cap
  - the token is not stored: no row's `tokenHash` equals the token
  - `http.test.ts` (fake request as in `src/server/auth/http.test.ts`, recording the cookie options): `setChallengeCookie('t')` sets `__Host-tm_pk_challenge` with exactly `{ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 300 }`; `challengeToken()` reads it; `clearChallengeCookie()` deletes that name with `path: '/'`, `secure: true`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `challenges.ts` and `http.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Store passkey challenges server-side, single use`.

### Task 4: Software authenticator, device kind, registration

**Files:**
- Create: `tests/support/softAuthenticator.ts`
- Create: `src/server/passkeys/deviceKind.ts`, `src/server/passkeys/register.ts`
- Test: `src/server/passkeys/deviceKind.test.ts`, `src/server/passkeys/register.test.ts`

**Interfaces:**
- Consumes: `PasskeyConfig` (Task 2), `issueChallenge` / `consumeChallenge` (Task 3), `CurrentUser` (`~/server/auth`), `writeAudit`.
- Produces:
  - `tests/support/softAuthenticator.ts`: `class SoftAuthenticator { constructor(opts: { rpId: string; origin: string }) ; register(options: PublicKeyCredentialCreationOptionsJSON, flags?: { userVerified?: boolean; origin?: string; rpId?: string }): RegistrationResponseJSON ; authenticate(options: PublicKeyCredentialRequestOptionsJSON, flags?: { userVerified?: boolean; origin?: string; rpId?: string; counter?: number; credentialId?: string; userHandle?: string }): AuthenticationResponseJSON }`. ES256 keys from `node:crypto` (`prime256v1`), attestation `none`, flags UP always, UV per flag, BE+BS set (synced passkey). It keeps each credential it made with its user handle and counter (+1 per `authenticate` unless `counter` given). CBOR: a minimal encoder in the same file (unsigned/negative ints, byte strings, text strings, maps); no new dependency.
  - `guessDeviceKind(userAgent: string | undefined): DeviceKind`: order matters: `iPad` → ipad; `iPhone` → iphone; `Android` → android; `Macintosh` → mac (iPadOS desktop UA reads as mac: acceptable, the user sees "Mac"); `Windows` → windows; `Linux` → linux; else other.
  - `interface PasskeySummary { id: number; deviceKind: DeviceKind; createdAt: string; lastUsedAt: string | null; backedUp: boolean }` (the only passkey shape that leaves the server; no credential id, key, counter, handle).
  - `type RegisterError = 'busy' | 'expired_challenge' | 'not_verified' | 'already_registered'`
  - `startRegistration(db: Db, user: CurrentUser, config: PasskeyConfig, now: Date): Promise<Result<{ token: string; options: PublicKeyCredentialCreationOptionsJSON }, 'busy'>>`
  - `finishRegistration(db: Db, user: CurrentUser, input: { token: string; response: RegistrationResponseJSON; userAgent: string | undefined }, config: PasskeyConfig, now: Date): Promise<Result<PasskeySummary, RegisterError>>`

Options: `rpName`, `rpID`, `userName: user.username`, `userDisplayName: user.displayName`, `userID` = the user's existing `userHandle` decoded, else 32 random bytes; `challenge` from `issueChallenge({ purpose: 'register', userId: user.id, userHandle })`; `attestationType: 'none'`; `excludeCredentials` = the user's passkeys (`id`, `transports`); `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`; `supportedAlgorithmIDs: [-8, -7, -257]` (pinned, so a library default change can't add algorithms silently); `timeout: 120_000`.

Finish: consume the challenge **first** (single use even when verify fails); null or `userId !== user.id` → `expired_challenge`. `verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true })`; a throw or `verified: false` → `not_verified`. Then one transaction: credential id already stored → `already_registered`; insert the row (`userHandle` from the challenge row), `deviceKind` from the User-Agent, `backedUp` from `registrationInfo.credentialBackedUp`, `counter` from `registrationInfo.credential.counter`; `writeAudit` `passkey.registered`, actor the user, entity `passkey` / row id, `after: { userId, deviceKind, backedUp }`.

- [ ] **Step 1:** Write `deviceKind.test.ts`: one real UA string per kind (iPhone Safari, iPad Safari, Android Chrome, macOS Safari, Windows Edge, Linux Firefox) + `undefined` and `''` → `other`.
- [ ] **Step 2:** Write `register.test.ts` (fixture like `family()` in `src/server/auth/auth.test.ts`; config `{ rpId: 'tm.test', rpName: 'Taskmaster', origin: 'https://tm.test' }`):
  - happy path: returns a `PasskeySummary` whose keys are exactly `['backedUp', 'createdAt', 'deviceKind', 'id', 'lastUsedAt']`; row stored with the browser's credential id; one `passkey.registered` entry whose JSON contains none of the credential id, public key or user handle
  - options pin: `authenticatorSelection` = `{ residentKey: 'required', userVerification: 'required', requireResidentKey: true }`, `attestation: 'none'`, `pubKeyCredParams` algs `[-8, -7, -257]`
  - second passkey of the same user: same `userHandle`, `excludeCredentials` lists the first
  - two users get different user handles, and the second user's `excludeCredentials` is empty (the first user's passkey is not listed)
  - replay: finishing twice with one token → second `expired_challenge`
  - wrong actor: tata's token finished by starsi → `expired_challenge`, nothing stored
  - a `login` challenge token used to finish a registration → `expired_challenge`
  - `userVerified: false` → `not_verified`; origin `https://evil.test` → `not_verified`; RP ID `evil.test` → `not_verified`; nothing stored in each
  - same credential registered again (a fresh challenge, the authenticator replays its response for the same credential) → `already_registered`
  - audit down (trigger on `passkey.registered`, as in `src/server/tasks/tasks.test.ts:140`) → throws, no passkey row
  - an admin password reset (`setPasswordHash`) leaves the user's passkeys in place
- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4:** Write `softAuthenticator.ts`, `deviceKind.ts`, `register.ts`.
- [ ] **Step 5:** Run → PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 6:** Commit `Register passkeys`.

### Task 5: Passkey login

**Files:**
- Create: `src/server/passkeys/login.ts`, test `src/server/passkeys/login.test.ts`

**Interfaces:**
- Consumes: challenges (Task 3), `reserveAttempt` / `releaseAttempt` / `limitKeys` (`~/server/auth/rateLimit`), `createSession`, `pruneExpiredSessions`, `toCurrentUser` (`~/server/auth/sessions`), `LoginSuccess` (`~/server/auth/login`).
- Produces:
  - `type PasskeyLoginError = 'busy' | 'rate_limited' | 'expired_challenge' | 'unknown_passkey' | 'not_verified'`
  - `startPasskeyLogin(db: Db, ip: string, config: PasskeyConfig, now: Date): Promise<Result<{ token: string; options: PublicKeyCredentialRequestOptionsJSON }, 'busy'>>`: `allowCredentials: []`, `userVerification: 'required'`, `timeout: 120_000`; the challenge is issued as `{ purpose: 'login', ip }`.
  - `finishPasskeyLogin(db: Db, input: { token: string; response: AuthenticationResponseJSON; ip: string }, config: PasskeyConfig, now: Date): Promise<Result<LoginSuccess, PasskeyLoginError>>`

Order: (1) consume the `login` challenge, null → `expired_challenge`. (2) find the passkey by `response.id`, missing → `unknown_passkey` (not counted in the rate limit: a phone offering a stale passkey must not use up the family's shared per-IP password allowance; each try still costs a one-time challenge, capped per IP, so the log grows at most 20 rows per IP per 5 minutes). (3) `reserveAttempt(db, limitKeys('passkey:' + passkey.id, ip), now)`, null → `rate_limited`, not logged (same reason as password login). (4) if `response.response.userHandle` is present and differs from the row's → `not_verified`. (5) `verifyAuthenticationResponse` with `requireUserVerification: true` and the stored credential; throw or not verified (this covers a counter that went backwards) → `not_verified`. (6) one transaction: re-read the passkey row by id (gone → `unknown_passkey`) and its user (not `active` → `not_verified`, logged with `reason: 'inactive'`); `releaseAttempt`; set `counter = newCounter`, `lastUsedAt = now`, `backedUp`; `pruneExpiredSessions`; `createSession(tx, userId, 'passkey', now)`; `writeAudit` `auth.login_succeeded`, `after: { method: 'passkey', ip, passkeyId }`. Every failure except `rate_limited` writes `auth.login_failed` (actor anonymous, entity `user` with the passkey's user id or `'unknown'`, `after: { method: 'passkey', reason, ip }`, `reason` = the error code or `inactive`) in its own transaction, like `src/server/auth/login.ts`.

- [ ] **Step 1: Write the failing tests** (register a passkey first through Task 4's functions):
  - happy path: `LoginSuccess` with `user` equal to `toCurrentUser(row)` (keys `displayName, id, role, username` only); the session row has `method: 'passkey'`; `counter` stored = authenticator's; `lastUsedAt = now`; one `auth.login_succeeded` with `method: 'passkey'`; `resolveSession(db, token, now)` finds the user
  - unknown credential (`credentialId` of a never-registered key) → `unknown_passkey`, one `auth.login_failed` with `reason: 'unknown_passkey'`, entity id `'unknown'`, no session
  - removed between start and finish: delete the row after `startPasskeyLogin`, then finish → `unknown_passkey`
  - removed during the verify: wrap so the row is deleted after step 5 (spy on `verifyAuthenticationResponse` via `vi.mock` of `@simplewebauthn/server` that calls the real one then deletes the row) → `unknown_passkey`, no session, no `auth.login_succeeded`
  - `userVerified: false` → `not_verified`; wrong origin; wrong RP ID → `not_verified`; each writes `auth.login_failed` with entity id = tata's id and `after` = `{ method: 'passkey', reason: 'not_verified', ip }`
  - inactive: deactivate tata (`updateUser`), then a valid passkey login → `not_verified`, no session, `auth.login_failed` with `reason: 'inactive'`
  - counter replay: authenticate with `counter: 5`, log in, then a fresh challenge with `counter: 5` again → `not_verified`
  - user handle mismatch (`userHandle` of another user) → `not_verified`
  - replayed token → second `expired_challenge`; a `register` token → `expired_challenge`; each writes `auth.login_failed` with `reason: 'expired_challenge'`, entity id `'unknown'`
  - rate limit boundary: with `MAX_FAILURES_PER_USER - 1` (9) failures for one passkey, the 10th attempt is still checked (and here fails); the 11th → `rate_limited` with no audit entry; after the window a good login clears that passkey's failures
  - unknown passkeys don't count: 40 `unknown_passkey` tries from one IP leave `login_failures` empty, and a password login from that IP still works
  - audit down on `auth.login_succeeded` → throws; no session row; counter unchanged
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `login.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Log in with a passkey`.

### Task 6: List and remove

**Files:**
- Create: `src/server/passkeys/manage.ts`, test `src/server/passkeys/manage.test.ts`

**Interfaces:**
- Produces:
  - `listPasskeys(db: Db | Tx, userId: number): PasskeySummary[]`, newest first; selects named columns only.
  - `removePasskey(db: Db, by: CurrentUser, passkeyId: number, now: Date): Result<void, 'not_found'>`: only the caller's own passkey (`where id and userId = by.id`); one transaction with `passkey.removed`, actor `by`, `before: { userId, deviceKind, createdAt }`.
  - `removeUserPasskeys(db: Db, by: CurrentUser, userId: number, now: Date): number`: the admin's wipe; the role check is the server function's guard; one transaction, one `passkey.removed` per row (same `before`, `reason: 'admin'`); returns how many.
  - `countPasskeysByUser(db: Db | Tx): Record<number, number>`: users with none are absent.

- [ ] **Step 1: Write the failing tests**:
  - list shape: each item's keys are exactly the `PasskeySummary` keys; only that user's rows; newest first
  - remove own → ok, row gone, one `passkey.removed`
  - wrong actor: starsi removes tata's passkey → `not_found`, row stays, no audit entry
  - unknown id → `not_found`
  - admin wipe of a user with 2 passkeys → `2`, both gone, 2 entries with actor admin; other users' passkeys untouched; a user with none → `0`, no entries
  - counts: `{ [tata]: 2, [starsi]: 1 }`
  - audit down on `passkey.removed` → throws, rows stay (both functions)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `manage.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `List and remove passkeys`.

### Task 7: Server functions, guards, docs

**Files:**
- Create: `src/server/passkeys/parse.ts`, `src/server/passkeys/handlers.ts`, `src/server/passkeys/functions.ts`, `src/server/passkeys/index.ts`, `src/server/passkeys/README.md`
- Modify: `src/server/auth/guards.ts:20-29`, `tests/server-fn-guards.test.ts:12-25`, `src/server/auth/README.md`
- Test: `src/server/passkeys/parse.test.ts`, `src/server/passkeys/handlers.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6; `setSessionCookie`, `clientIp`, `getRequestHeader` (user agent).
- Produces (part 2 calls these; all `POST` unless noted):

| Function | Guard | Input | Returns |
| --- | --- | --- | --- |
| `getPasskeysEnabledFn` (GET) | public | none | `boolean` |
| `passkeyLoginOptionsFn` | public | none | `{ ok: true; options } \| { ok: false; error: 'disabled' \| 'busy' }`, sets the challenge cookie |
| `passkeyLoginFn` | public | `AuthenticationResponseJSON` | `{ ok: true; user: CurrentUser } \| { ok: false; error: 'disabled' \| PasskeyLoginError }`, sets the session cookie, clears the challenge cookie |
| `passkeyRegisterOptionsFn` | `requireUser` | none | `{ ok: true; options } \| { ok: false; error: 'disabled' \| 'busy' }` |
| `passkeyRegisterFn` | `requireUser` | `RegistrationResponseJSON` | `{ ok: true; passkey: PasskeySummary } \| { ok: false; error: 'disabled' \| RegisterError }` |
| `listMyPasskeysFn` (GET) | `requireUser` | none | `PasskeySummary[]` |
| `removeMyPasskeyFn` | `requireUser` | `{ passkeyId: number }` | `{ ok: true } \| { ok: false; error: 'not_found' }` |
| `listPasskeyCountsFn` (GET) | `requireRole('admin')` | none | `Record<number, number>` |
| `removeUserPasskeysFn` | `requireRole('admin')` | `{ userId: number }` | `{ removed: number }` |

  - Validators in `src/server/passkeys/parse.ts`: `parseRegistrationResponse(data: unknown): RegistrationResponseJSON`, `parseAuthenticationResponse(data: unknown): AuthenticationResponseJSON`, `parseId(data: unknown, key: 'passkeyId' | 'userId'): number`. They check the shape the library reads (`id`, `rawId` base64url strings ≤ 1366 chars, `type === 'public-key'`, `response` with the right base64url string fields, optional `transports` string array, optional `userHandle`), and refuse a JSON body over 16 KB (`JSON.stringify(data).length`). Throw `Error('Invalid passkey response')` like `parseLoginForm`. Ids: positive safe integers.
  - A missing challenge cookie → `expired_challenge` (no throw).
  - `handlers.ts` holds each body as a plain function with the same name minus `Fn` (`passkeysEnabled(env)`, `passkeyLoginOptions(env)`, `passkeyLogin(data, env)`, `passkeyRegisterOptions(user, env)`, `passkeyRegister(user, data, env)`, `listMyPasskeys(user)`, `removeMyPasskey(user, data)`, `listPasskeyCounts()`, `removeUserPasskeys(admin, data)`); they read the request through `./http`, `~/server/auth/http` and `getDb()`, and return exactly the table's shapes. `functions.ts` is only `createServerFn().middleware(...).validator(...).handler(({ data, context }) => handler(...))`.

- [ ] **Step 1: Write the failing tests** `parse.test.ts`: a real response from `SoftAuthenticator` passes both parsers unchanged; `id`/`rawId` of exactly 1366 chars pass, 1367 throw; a body of 16 KB − 1 passes, one over 16 KB throws; each of these throws: `null`, missing `id`, `type: 'x'`, non-base64url `rawId`, `response.clientDataJSON` a number; `parseId({ passkeyId: 0 })`, `-1`, `1.5`, `'3'` throw; `parseId({ passkeyId: 3 }, 'passkeyId')` → 3.
- [ ] **Step 1b: Write the failing tests** `handlers.test.ts` (fake request and `getDb` mocked as in `src/server/auth/http.test.ts`; `SoftAuthenticator` for the browser side; env passed in):
  - off (`{}`): `passkeysEnabled` → `false`; `passkeyLoginOptions`, `passkeyLogin`, `passkeyRegisterOptions`, `passkeyRegister` → `{ ok: false, error: 'disabled' }`, no cookie set, no challenge row; `listMyPasskeys` and `removeMyPasskey` still work
  - on: `passkeysEnabled` → `true`; register options → finish → the reply's keys are exactly `['ok', 'passkey']`; login options set the challenge cookie; `passkeyLogin` with that cookie → reply keys exactly `['ok', 'user']` (no token anywhere in the reply's JSON), the session cookie set with the new token, the challenge cookie cleared
  - no challenge cookie → `{ ok: false, error: 'expired_challenge' }`
  - `removeUserPasskeys(admin, { userId })` → `{ removed: n }`; `listPasskeyCounts` → the counts
  - login options from fake IP `10.0.0.2` store a row whose `ipKey` is `sha256('10.0.0.2')`; a second call from `10.0.0.3` stores a different `ipKey` (the per-IP cap gets the real client IP via `clientIp()`)
- [ ] **Step 2:** Add the 3 public functions to `PUBLIC_SERVER_FNS` with reasons (`getPasskeysEnabledFn`: a yes/no about the deployment; the two login ones: the way in, like `loginFn`), file `passkeys/functions.ts`. Add the 6 guarded ones to `EXPECTED_ROLES` (`any` for the four `requireUser`, `admin` for the two admin ones).
- [ ] **Step 3:** Run `parse.test.ts`, `handlers.test.ts` and `tests/server-fn-guards.test.ts` → FAIL.
- [ ] **Step 4:** Implement `parse.ts`, `handlers.ts` and `functions.ts`. Each handler reads `passkeyConfig(env)` and answers `disabled` when null (list and remove don't need it). Handlers stay thin: call Tasks 3 to 6, set or clear cookies.
- [ ] **Step 5:** Run both → PASS.
- [ ] **Step 6:** Write `src/server/passkeys/README.md` (what each file does, the cookie, the challenge flow in 5 lines, config, "screens import only `functions`"); in `src/server/auth/README.md` replace "Passkeys (#29) … build on this" with a link, and add `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` under Config.
- [ ] **Step 7:** Commit `Passkey server functions`.

### Task 8: Verify through the real entry point

- [ ] **Step 1:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm db:check`. All PASS.
- [ ] **Step 2:** `pnpm build`, then `TASKMASTER_ENV=preview DATA_DIR=$(mktemp -d) pnpm start`. Expected boot line `[auth] passkeys off (WEBAUTHN_RP_ID not set)`; `/api/health` 200.
- [ ] **Step 3:** Same with `WEBAUTHN_RP_ID=localhost WEBAUTHN_ORIGIN=http://localhost:3000`: boot line `passkeys on for localhost`. With `WEBAUTHN_RP_ID=https://x`: the server exits with the `PasskeyConfigError` message.
- [ ] **Step 4:** The browser path (a real `navigator.credentials` call through the server functions) is tested in part 2, where the screens call them, with a Playwright virtual authenticator and Jakub's iPhone. Here the unit tests run the real `@simplewebauthn/server` verify end to end against the software authenticator.
- [ ] **Step 5:** Note the counts for the brief: tests added, lines changed.

---

## Tests pre-flight

| Ask | Where |
| --- | --- |
| each state change rolls back when the audit write fails | Task 4 (register), Task 5 (login), Task 6 (remove, wipe) |
| each limit, cutoff and window at its boundary | Task 3 (TTL ±1 ms, per-IP 19/20, global 499/500, per-user register 5/6), Task 5 (rate limit 10th/11th), Task 7 (parse caps 1366/1367, 16 KB) |
| each action by a wrong actor | Task 4 (other user's challenge), Task 6 (other user's passkey), Task 7 (guard roles pinned) |
| each new module runs once through its real entry point | Task 8 (built server boots with and without config, bad config stops it); browser path in part 2 |
| return shapes pinned, no secret fields | Task 4 (`PasskeySummary` keys, audit JSON), Task 5 (`CurrentUser` keys), Task 6 (list keys), Task 7 (each handler's reply keys; no session token in `passkeyLogin`'s reply) |

## Not in this PR

- Screens, Czech strings, `@simplewebauthn/browser`, `signalUnknownCredential` to make the phone forget a dead passkey: part 2.
- The library inside the built bundle: Task 8 only boots `.output`. Part 2 runs its Playwright virtual-authenticator test against `pnpm build && pnpm start`, not `pnpm dev`, so a bundling gap shows there before merge.
- Demo data: previews run with passkeys off, so there is nothing to seed. Part 2 states the same.
- Passkey provider names from AAGUID metadata (needs the FIDO metadata service, network at boot): not needed; the device kind from the User-Agent is enough.
