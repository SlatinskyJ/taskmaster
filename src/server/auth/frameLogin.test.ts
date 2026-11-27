import { describe, expect, it } from 'vitest'
import { createTestDb } from '~/server/db/testing'
import type { Db } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import { seedDemo } from '~/server/demo'
import { frameLogin } from './frameLogin'
import { resolveSession } from './sessions'

const PROD = { NODE_ENV: 'production' }
const PREVIEW = { NODE_ENV: 'production', TASKMASTER_ENV: 'preview' }
const DEMO = { NODE_ENV: 'production', TASKMASTER_ENV: 'demo' }
const T0 = new Date('2026-11-26T10:00:00.000Z')
const IP = '10.0.0.2'

function demoDb(): Db {
  const db = createTestDb()
  const seeded = seedDemo(db, { TASKMASTER_ENV: 'preview', TASKMASTER_SEED: 'family' }, T0)
  if (seeded.kind !== 'seeded') throw new Error(seeded.reason)
  return db
}

/** A database any query on fails: proves a refusal happens before the DB is touched. */
const UNTOUCHABLE = new Proxy(
  {},
  {
    get() {
      throw new Error('DB touched')
    },
  },
) as Db

describe('frameLogin', () => {
  it('refuses with TASKMASTER_ENV=preview when ADMIN_PASSWORD is set', async () => {
    expect(
      await frameLogin(UNTOUCHABLE, { ...PREVIEW, ADMIN_PASSWORD: 'x'.repeat(12) }, 'tata', IP, T0),
    ).toEqual({ ok: false, error: 'not_available' })
  })

  it('production refuses without touching the DB', async () => {
    expect(await frameLogin(UNTOUCHABLE, PROD, 'tata', IP, T0)).toEqual({
      ok: false,
      error: 'not_available',
    })
  })

  it('refuses a name outside the demo family', async () => {
    expect(await frameLogin(UNTOUCHABLE, PREVIEW, 'jakub', IP, T0)).toEqual({
      ok: false,
      error: 'unknown_user',
    })
  })

  it('logs a demo user in and returns a working session token', async () => {
    const db = demoDb()
    const result = await frameLogin(db, PREVIEW, 'starsi', IP, T0)
    if (!result.ok) throw new Error(result.error)
    expect(result.user.username).toBe('starsi')
    expect(resolveSession(db, result.token, T0)?.user.username).toBe('starsi')
  })

  it('logs a demo user in on the demo (TASKMASTER_ENV=demo), a production build', async () => {
    const result = await frameLogin(demoDb(), DEMO, 'tata', IP, T0)
    if (!result.ok) throw new Error(result.error)
    expect(result.user.username).toBe('tata')
  })

  it('refuses on the demo when ADMIN_PASSWORD is set', async () => {
    expect(
      await frameLogin(UNTOUCHABLE, { ...DEMO, ADMIN_PASSWORD: 'x'.repeat(12) }, 'tata', IP, T0),
    ).toEqual({ ok: false, error: 'not_available' })
  })

  it('two logins of the same user are two sessions', async () => {
    const db = demoDb()
    const a = await frameLogin(db, PREVIEW, 'tata', IP, T0)
    const b = await frameLogin(db, PREVIEW, 'tata', IP, T0)
    if (!a.ok || !b.ok) throw new Error('login failed')
    expect(a.token).not.toBe(b.token)
    expect(resolveSession(db, a.token, T0)?.session.id).not.toBe(
      resolveSession(db, b.token, T0)?.session.id,
    )
  })

  it('result shape is exactly { ok, token, user } and user is the CurrentUser shape (no password hash)', async () => {
    const result = await frameLogin(demoDb(), PREVIEW, 'mladsi', IP, T0)
    if (!result.ok) throw new Error(result.error)
    expect(Object.keys(result).sort()).toEqual(['ok', 'token', 'user'])
    expect(Object.keys(result.user).sort()).toEqual(['displayName', 'id', 'role', 'username'])
  })

  it('logs in through the normal login: its audit entry is written', async () => {
    const db = demoDb()
    const before = db.select().from(auditLog).all().length
    await frameLogin(db, PREVIEW, 'tata', IP, T0)
    const rows = db.select().from(auditLog).all()
    expect(rows).toHaveLength(before + 1)
    expect(rows.at(-1)?.action).toBe('auth.login_succeeded')
  })

  it('a wrong-env call writes no audit row', async () => {
    const db = demoDb()
    const before = db.select().from(auditLog).all().length
    expect((await frameLogin(db, PROD, 'tata', IP, T0)).ok).toBe(false)
    expect(db.select().from(auditLog).all()).toHaveLength(before)
  })
})
