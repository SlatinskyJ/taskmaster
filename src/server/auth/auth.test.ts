import { hashSync } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Actor } from '~/server/audit'
import type { Db } from '~/server/db'
import { auditLog, loginFailures, sessions, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { createUser, setPasswordHash, updateUser } from '~/server/users'
import { pickClientIp } from './clientIp'
import { login, logout } from './login'
import { MAX_PASSWORD_LENGTH } from './password'
import { FAILURE_WINDOW_MS, MAX_FAILURES_PER_IP, MAX_FAILURES_PER_USER } from './rateLimit'
import { hashToken, RENEW_AFTER_MS, resolveSession, SESSION_DAYS } from './sessions'

const PASSWORD = 'správné heslo 42'
// One hash for the whole file: argon2 is slow on purpose.
const HASH = hashSync(PASSWORD)
const T0 = new Date('2026-11-17T10:00:00.000Z')
const IP = '203.0.113.7'
const DAY = 24 * 60 * 60 * 1000
const at = (ms: number) => new Date(T0.getTime() + ms)

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function family(): { db: Db; admin: number; tata: number; by: Actor } {
  const db = createTestDb()
  const sys: Actor = { kind: 'system' }
  const admin = must(
    createUser(
      db,
      sys,
      { username: 'admin', displayName: 'Admin', role: 'admin', passwordHash: HASH },
      T0,
    ),
  ).id
  const by: Actor = { kind: 'user', userId: admin }
  const tata = must(
    createUser(
      db,
      by,
      { username: 'tata', displayName: 'Táta', role: 'giver', passwordHash: HASH },
      T0,
    ),
  ).id
  return { db, admin, tata, by }
}

const audit = (db: Db) => db.select().from(auditLog).all()
const attempt = (db: Db, password: string, now = T0, username = 'tata', ip = IP) =>
  login(db, { username, password, ip }, now)

describe('password login (spec §6, §11 Auth)', () => {
  it('right password opens a session; the DB keeps only the token hash', async () => {
    const { db, tata } = family()
    const r = must(await attempt(db, PASSWORD))
    expect(r.user).toEqual({ id: tata, username: 'tata', displayName: 'Táta', role: 'giver' })
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const [row] = db.select().from(sessions).all()
    expect(row).toMatchObject({ userId: tata, method: 'password', tokenHash: hashToken(r.token) })
    expect(JSON.stringify(db.select().from(sessions).all())).not.toContain(r.token)
    expect(JSON.stringify(audit(db))).not.toContain(r.token)
    expect(r.expiresAt).toEqual(at(SESSION_DAYS * DAY))
  })

  it('username is case- and space-insensitive', async () => {
    const { db } = family()
    expect((await attempt(db, PASSWORD, T0, '  Tata ')).ok).toBe(true)
  })

  it('success is audit-logged with the session, method and IP', async () => {
    const { db, tata } = family()
    const r = must(await attempt(db, PASSWORD))
    const entry = audit(db).at(-1)
    expect(entry).toMatchObject({
      action: 'auth.login_succeeded',
      actorKind: 'user',
      actorUserId: tata,
      entityType: 'session',
    })
    expect(JSON.parse(entry?.after ?? '{}')).toEqual({ method: 'password', ip: IP })
    expect(entry?.entityId).toBe(String(db.select().from(sessions).get()?.id))
    expect(r.user.id).toBe(tata)
  })

  it('wrong password, unknown user and inactive user all get the same answer', async () => {
    const { db, by, tata } = family()
    expect(await attempt(db, 'nope')).toEqual({ ok: false, error: 'invalid_credentials' })
    expect(await attempt(db, PASSWORD, T0, 'nikdo')).toEqual({
      ok: false,
      error: 'invalid_credentials',
    })
    must(updateUser(db, by, tata, { active: false }, T0))
    expect(await attempt(db, PASSWORD)).toEqual({ ok: false, error: 'invalid_credentials' })
    expect(db.select().from(sessions).all()).toHaveLength(0)
  })

  it('a user without a password cannot log in', async () => {
    const { db, by } = family()
    must(createUser(db, by, { username: 'mama', displayName: 'Máma', role: 'giver' }, T0))
    expect(await attempt(db, '', T0, 'mama')).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('an over-long password is refused without hashing it', async () => {
    const { db } = family()
    const long = PASSWORD + 'x'.repeat(MAX_PASSWORD_LENGTH)
    expect(await attempt(db, long)).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('failures are audit-logged as anonymous; an unknown username is never stored', async () => {
    const { db, tata } = family()
    await attempt(db, 'nope')
    await attempt(db, PASSWORD, T0, 'heslo-omylem-v-jmenu')
    const [wrong, unknown] = audit(db).slice(-2)
    expect(wrong).toMatchObject({
      action: 'auth.login_failed',
      actorKind: 'anonymous',
      entityType: 'user',
      entityId: String(tata),
    })
    expect(JSON.parse(wrong?.after ?? '{}')).toEqual({ reason: 'wrong_password', ip: IP })
    expect(unknown).toMatchObject({ action: 'auth.login_failed', entityId: 'unknown' })
    expect(JSON.parse(unknown?.after ?? '{}')).toEqual({ reason: 'unknown_user', ip: IP })
    expect(JSON.stringify(audit(db))).not.toContain('heslo-omylem')
    expect(JSON.stringify(audit(db))).not.toContain('nope')
  })
})

describe('rate limit (spec §6, §11 Auth)', () => {
  it(`locks a username after ${String(MAX_FAILURES_PER_USER)} failures in 15 minutes, even with the right password`, async () => {
    const { db } = family()
    for (let i = 0; i < MAX_FAILURES_PER_USER; i++)
      await attempt(db, 'nope', at(i * 1000), 'tata', `10.0.0.${String(i)}`)
    const before = audit(db).length
    expect(await attempt(db, PASSWORD, at(60_000), 'tata', '10.0.1.1')).toEqual({
      ok: false,
      error: 'rate_limited',
    })
    // Refusals while limited are neither logged nor counted.
    expect(audit(db)).toHaveLength(before)
    expect(
      db.select().from(loginFailures).where(eq(loginFailures.key, 'user:tata')).all(),
    ).toHaveLength(MAX_FAILURES_PER_USER)
    // Other users are not affected.
    expect((await attempt(db, PASSWORD, at(60_000), 'admin', '10.0.1.1')).ok).toBe(true)
  })

  it('the lock lifts once the oldest failures leave the window', async () => {
    const { db } = family()
    for (let i = 0; i < MAX_FAILURES_PER_USER; i++)
      await attempt(db, 'nope', T0, 'tata', `10.0.0.${String(i)}`)
    expect((await attempt(db, PASSWORD, at(FAILURE_WINDOW_MS - 1))).ok).toBe(false)
    expect((await attempt(db, PASSWORD, at(FAILURE_WINDOW_MS))).ok).toBe(true)
  })

  it(`locks an IP after ${String(MAX_FAILURES_PER_IP)} failures across usernames`, async () => {
    const { db } = family()
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) await attempt(db, 'nope', T0, `host${String(i)}`)
    expect(await attempt(db, PASSWORD)).toEqual({ ok: false, error: 'rate_limited' })
    expect((await attempt(db, PASSWORD, T0, 'tata', '198.51.100.1')).ok).toBe(true)
  })

  it("success clears the username's failures, not the IP's", async () => {
    const { db } = family()
    for (let i = 0; i < MAX_FAILURES_PER_USER - 1; i++) await attempt(db, 'nope')
    must(await attempt(db, PASSWORD))
    const keys = db
      .select()
      .from(loginFailures)
      .all()
      .map((f) => f.key)
    expect(keys).not.toContain('user:tata')
    expect(keys.filter((k) => k === `ip:${IP}`)).toHaveLength(MAX_FAILURES_PER_USER - 1)
  })

  it('old failures are pruned', async () => {
    const { db } = family()
    await attempt(db, 'nope')
    await attempt(db, 'nope', at(FAILURE_WINDOW_MS + 1), 'admin')
    expect(
      db
        .select()
        .from(loginFailures)
        .all()
        .map((f) => f.at),
    ).toEqual([at(FAILURE_WINDOW_MS + 1).toISOString(), at(FAILURE_WINDOW_MS + 1).toISOString()])
  })
})

describe('sessions (spec §11 Sessions [call])', () => {
  it('resolve the user from the token; unknown or malformed tokens give null', async () => {
    const { db, tata } = family()
    const { token } = must(await attempt(db, PASSWORD))
    expect(resolveSession(db, token, at(1000))?.user.id).toBe(tata)
    expect(resolveSession(db, 'x'.repeat(43), T0)).toBeNull()
    expect(resolveSession(db, 'short', T0)).toBeNull()
  })

  it('slide: use after a day moves the expiry to 90 days from that use', async () => {
    const { db } = family()
    const { token } = must(await attempt(db, PASSWORD))
    expect(resolveSession(db, token, at(RENEW_AFTER_MS - 1))?.renewed).toBe(false)
    const later = at(30 * DAY)
    const r = resolveSession(db, token, later)
    expect(r?.renewed).toBe(true)
    expect(r?.session.expiresAt).toBe(new Date(later.getTime() + SESSION_DAYS * DAY).toISOString())
    expect(r?.session.lastSeenAt).toBe(later.toISOString())
  })

  it('expire 90 days after the last use, and the dead row is deleted', async () => {
    const { db } = family()
    const { token } = must(await attempt(db, PASSWORD))
    expect(resolveSession(db, token, at(SESSION_DAYS * DAY - 1))).not.toBeNull()
    const { token: t2 } = must(await attempt(db, PASSWORD))
    expect(resolveSession(db, t2, at(SESSION_DAYS * DAY))).toBeNull()
    expect(
      db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(t2)))
        .get(),
    ).toBeUndefined()
  })

  it('an inactive user’s session gives null', async () => {
    const { db, by, tata } = family()
    const { token } = must(await attempt(db, PASSWORD))
    must(updateUser(db, by, tata, { active: false }, T0))
    expect(resolveSession(db, token, T0)).toBeNull()
  })

  it('logout deletes the session and logs it; a second logout does nothing', async () => {
    const { db, tata } = family()
    const { token } = must(await attempt(db, PASSWORD))
    logout(db, token, at(1000))
    expect(resolveSession(db, token, at(2000))).toBeNull()
    expect(audit(db).at(-1)).toMatchObject({
      action: 'auth.logout',
      actorKind: 'user',
      actorUserId: tata,
      entityType: 'session',
    })
    const count = audit(db).length
    logout(db, token, at(3000))
    logout(db, 'garbage', at(3000))
    expect(audit(db)).toHaveLength(count)
  })

  it('a password reset ends all the user’s sessions, others stay (spec §6)', async () => {
    const { db, by, tata } = family()
    const phone = must(await attempt(db, PASSWORD)).token
    const laptop = must(await attempt(db, PASSWORD)).token
    const admin = must(await attempt(db, PASSWORD, T0, 'admin')).token
    must(setPasswordHash(db, by, tata, hashSync('nové heslo 12'), at(1000)))
    expect(resolveSession(db, phone, at(2000))).toBeNull()
    expect(resolveSession(db, laptop, at(2000))).toBeNull()
    expect(resolveSession(db, admin, at(2000))).not.toBeNull()
    expect(JSON.parse(audit(db).at(-1)?.after ?? '{}')).toMatchObject({ sessionsEnded: 2 })
    expect((await attempt(db, PASSWORD, at(3000))).ok).toBe(false)
    expect((await attempt(db, 'nové heslo 12', at(3000))).ok).toBe(true)
  })

  it('login prunes expired sessions of everyone', async () => {
    const { db } = family()
    must(await attempt(db, PASSWORD))
    must(await attempt(db, PASSWORD, at(SESSION_DAYS * DAY), 'admin'))
    expect(
      db
        .select()
        .from(sessions)
        .all()
        .map((s) => s.userId),
    ).toEqual([db.select().from(users).where(eq(users.username, 'admin')).get()?.id])
  })
})

describe('client IP for the rate limit', () => {
  it('uses the last X-Forwarded-For entry (the one our proxy added), else the socket', () => {
    expect(pickClientIp('6.6.6.6, 203.0.113.7', '127.0.0.1')).toBe('203.0.113.7')
    expect(pickClientIp(' 203.0.113.7 ', '127.0.0.1')).toBe('203.0.113.7')
    expect(pickClientIp(undefined, '127.0.0.1')).toBe('127.0.0.1')
    expect(pickClientIp('', '127.0.0.1')).toBe('127.0.0.1')
    expect(pickClientIp(undefined, undefined)).toBe('unknown')
  })
})
