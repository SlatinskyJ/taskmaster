import { hashSync } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '~/server/auth/login'
import { limitKeys, MAX_FAILURES_PER_USER } from '~/server/auth/rateLimit'
import { createSession } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { auditLog, loginFailures, sessions, users } from '~/server/db/schema'
import type { AuditAction } from '~/server/audit/actions'
import { createTestDb } from '~/server/db/testing'
import { changeOwnPassword } from './changePassword'
import type { ChangePasswordInput } from './changePassword'
import type * as PasswordModule from '~/server/auth/password'
import { createUser, setPasswordHash } from './manage'

// Changing your own password on Profil (#210, spec §6).

// The real argon2, plus a hook the race test runs inside hashPassword (after the check).
const hooks = vi.hoisted(() => ({ onHash: null as null | (() => void) }))
vi.mock('~/server/auth/password', async (importOriginal) => {
  const real = await importOriginal<typeof PasswordModule>()
  return {
    ...real,
    verifyPassword: vi.fn(real.verifyPassword),
    hashPassword: vi.fn(async (password: string) => {
      const h = await real.hashPassword(password)
      hooks.onHash?.()
      return h
    }),
  }
})
const { verifyPassword } = await import('~/server/auth/password')

const OLD = 'demo1234'
// One hash for the whole file: argon2 is slow on purpose.
const OLD_HASH = hashSync(OLD)
const OTHER_HASH = hashSync('admin-chosen-1')
const T0 = new Date('2026-11-24T10:00:00.000Z')
const IP = '203.0.113.7'

beforeEach(() => {
  hooks.onHash = null
  vi.mocked(verifyPassword).mockClear()
})

function setup(db: Db = createTestDb()) {
  const add = (username: string, passwordHash: string | null) => {
    const r = createUser(
      db,
      { kind: 'system' },
      { username, displayName: username, role: 'taker', passwordHash },
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
  const me = add('starsi', OLD_HASH)
  const other = add('mladsi', OLD_HASH)
  const here = createSession(db, me.id, 'password', T0).session
  const phone = createSession(db, me.id, 'password', T0).session
  const theirs = createSession(db, other.id, 'password', T0).session
  const input = (over: Partial<ChangePasswordInput> = {}): ChangePasswordInput => ({
    userId: me.id,
    sessionId: here.id,
    current: OLD,
    next: 'noveheslo1',
    logOutOthers: true,
    ip: IP,
    ...over,
  })
  return { db, me, other, here, phone, theirs, input, add }
}

const sessionIds = (db: Db) =>
  db
    .select({ id: sessions.id })
    .from(sessions)
    .all()
    .map((s) => s.id)
    .sort()
const hashOf = (db: Db, id: number) =>
  db.select().from(users).where(eq(users.id, id)).get()?.passwordHash
const failuresFor = (db: Db, key: string) =>
  db.select().from(loginFailures).where(eq(loginFailures.key, key)).all().length
const actions = (db: Db, action: AuditAction) =>
  db.select().from(auditLog).where(eq(auditLog.action, action)).all()
const canLogIn = async (db: Db, password: string, ip = '198.51.100.1') =>
  (await login(db, { username: 'starsi', password, ip }, T0)).ok

describe('changeOwnPassword (#210)', () => {
  it('box ticked: the new password works, the old does not, only the other sessions end', async () => {
    const { db, input, here, theirs } = setup()
    expect(await changeOwnPassword(db, input(), T0)).toEqual({
      ok: true,
      value: { sessionsEnded: 1 },
    })
    expect(sessionIds(db)).toEqual([here.id, theirs.id].sort())
    expect(await canLogIn(db, OLD)).toBe(false)
    expect(await canLogIn(db, 'noveheslo1')).toBe(true)
  })

  it('box unticked: every session stays', async () => {
    const { db, input, here, phone, theirs } = setup()
    expect(await changeOwnPassword(db, input({ logOutOthers: false }), T0)).toEqual({
      ok: true,
      value: { sessionsEnded: 0 },
    })
    expect(sessionIds(db)).toEqual([here.id, phone.id, theirs.id].sort())
  })

  it('a wrong current password: refused, counted, logged, nothing changed', async () => {
    const { db, input, me } = setup()
    expect(await changeOwnPassword(db, input({ current: 'spatne-heslo' }), T0)).toEqual({
      ok: false,
      error: 'wrong_password',
    })
    expect(hashOf(db, me.id)).toBe(OLD_HASH)
    expect(sessionIds(db)).toHaveLength(3)
    const failed = actions(db, 'auth.password_change_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.actorUserId).toBe(me.id)
    expect(JSON.parse(failed[0]?.after ?? 'null')).toEqual({ ip: IP })
    const keys = limitKeys('starsi', IP)
    expect(failuresFor(db, keys.user)).toBe(1)
    expect(failuresFor(db, keys.ip)).toBe(1)
  })

  it('an account with no password hash counts as a wrong password, never verified', async () => {
    const { db, add } = setup()
    const nohash = add('bezhesla', null)
    const s = createSession(db, nohash.id, 'passkey', T0).session
    const r = await changeOwnPassword(
      db,
      {
        userId: nohash.id,
        sessionId: s.id,
        current: 'cokoliv1',
        next: 'noveheslo1',
        logOutOthers: true,
        ip: IP,
      },
      T0,
    )
    expect(r).toEqual({ ok: false, error: 'wrong_password' })
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(hashOf(db, nohash.id)).toBeNull()
    expect(failuresFor(db, limitKeys('bezhesla', IP).user)).toBe(1)
  })

  it('shares the login rate limit: 10 wrong changes block the 11th and a login from another IP', async () => {
    const { db, input, me } = setup()
    for (let i = 0; i < MAX_FAILURES_PER_USER; i++) {
      expect((await changeOwnPassword(db, input({ current: 'spatne-heslo' }), T0)).ok).toBe(false)
    }
    vi.mocked(verifyPassword).mockClear()
    expect(await changeOwnPassword(db, input(), T0)).toEqual({ ok: false, error: 'rate_limited' })
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(hashOf(db, me.id)).toBe(OLD_HASH)
    const other = await login(db, { username: 'starsi', password: OLD, ip: '198.51.100.9' }, T0)
    expect(other).toEqual({ ok: false, error: 'rate_limited' })
  })

  it('9 wrong changes still let the 10th, with the right password, through', async () => {
    const { db, input, me } = setup()
    for (let i = 0; i < MAX_FAILURES_PER_USER - 1; i++) {
      await changeOwnPassword(db, input({ current: 'spatne-heslo' }), T0)
    }
    expect((await changeOwnPassword(db, input(), T0)).ok).toBe(true)
    expect(hashOf(db, me.id)).not.toBe(OLD_HASH)
    // A right password clears the name's failures, as a login does.
    expect(failuresFor(db, limitKeys('starsi', IP).user)).toBe(0)
  })

  it('new password lengths: 7 and 257 refused without counting, 8 and 256 accepted', async () => {
    for (const [len, okay] of [
      [7, false],
      [8, true],
      [256, true],
      [257, false],
    ] as const) {
      const { db, input } = setup()
      const r = await changeOwnPassword(db, input({ next: 'x'.repeat(len) }), T0)
      if (okay) expect(r.ok).toBe(true)
      else {
        expect(r).toEqual({ ok: false, error: 'invalid_password' })
        expect(db.select().from(loginFailures).all()).toHaveLength(0)
        expect(actions(db, 'auth.password_change_failed')).toHaveLength(0)
      }
    }
  })

  it('a current password over 256 characters is wrong and never verified', async () => {
    const { db, input } = setup()
    const r = await changeOwnPassword(db, input({ current: 'x'.repeat(257) }), T0)
    expect(r).toEqual({ ok: false, error: 'wrong_password' })
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it('race: the admin resets the password during the check → changed, the reset stays', async () => {
    const { db, input, me } = setup()
    hooks.onHash = () => {
      const r = setPasswordHash(db, { kind: 'system' }, me.id, OTHER_HASH, T0)
      if (!r.ok) throw new Error(r.error)
    }
    expect(await changeOwnPassword(db, input({ logOutOthers: false }), T0)).toEqual({
      ok: false,
      error: 'changed',
    })
    expect(hashOf(db, me.id)).toBe(OTHER_HASH)
    // The reset ended all of this user's sessions itself; the change ended none of the other user's.
    expect(sessionIds(db)).toHaveLength(1)
    // The password was right: the attempt is released.
    expect(failuresFor(db, limitKeys('starsi', IP).user)).toBe(0)
  })

  it("never touches another user's password or sessions", async () => {
    const { db, input, other, theirs } = setup()
    await changeOwnPassword(db, input(), T0)
    expect(hashOf(db, other.id)).toBe(OLD_HASH)
    expect(sessionIds(db)).toContain(theirs.id)
  })
})
