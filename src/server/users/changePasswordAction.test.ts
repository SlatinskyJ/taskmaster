import { hashSync } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createSession } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { auditLog, loginFailures, sessions, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { changePasswordAction } from './actions'
import { createUser } from './manage'

// The handler behind changePasswordFn (#210): the switch, the session cookie, the result shape.

const OLD = 'demo1234'
const OLD_HASH = hashSync(OLD)
const T0 = new Date('2026-11-24T10:00:00.000Z')
const IP = '203.0.113.7'

function setup(switchOn: boolean) {
  const db = createTestDb()
  if (switchOn) db.run(sql`UPDATE feature_flags SET enabled = 1 WHERE key = 'passwordChange'`)
  const add = (username: string) => {
    const r = createUser(
      db,
      { kind: 'system' },
      { username, displayName: username, role: 'taker', passwordHash: OLD_HASH },
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
  const me = add('starsi')
  const other = add('mladsi')
  const here = createSession(db, me.id, 'password', T0)
  createSession(db, me.id, 'password', T0)
  const theirs = createSession(db, other.id, 'password', T0)
  return { db, me, other, here, theirs }
}

const data = (logOutOthers: boolean) => ({ current: OLD, next: 'noveheslo1', logOutOthers })
const count = (db: Db, table: typeof sessions | typeof auditLog | typeof loginFailures) =>
  db.select().from(table).all().length
const hashOf = (db: Db, id: number) =>
  db.select().from(users).where(eq(users.id, id)).get()?.passwordHash

describe('changePasswordAction (#210)', () => {
  it('switch off (as migrated): feature_off, nothing checked or written', async () => {
    const { db, me, here } = setup(false)
    const audits = count(db, auditLog)
    expect(await changePasswordAction(db, me.id, here.token, data(true), IP, T0)).toStrictEqual({
      ok: false,
      error: 'feature_off',
    })
    expect(hashOf(db, me.id)).toBe(OLD_HASH)
    expect(count(db, sessions)).toBe(3)
    expect(count(db, auditLog)).toBe(audits)
    expect(count(db, loginFailures)).toBe(0)
  })

  it('box ticked: ends the other session and says how many, nothing else', async () => {
    const { db, me, here } = setup(true)
    expect(await changePasswordAction(db, me.id, here.token, data(true), IP, T0)).toStrictEqual({
      ok: true,
      othersLoggedOut: 1,
    })
    expect(count(db, sessions)).toBe(2)
  })

  it('box unticked: keeps the other session', async () => {
    const { db, me, here } = setup(true)
    expect(await changePasswordAction(db, me.id, here.token, data(false), IP, T0)).toStrictEqual({
      ok: true,
      othersLoggedOut: 0,
    })
    expect(count(db, sessions)).toBe(3)
  })

  it('passes errors through', async () => {
    const { db, me, here } = setup(true)
    const wrong = { current: 'spatne-heslo', next: 'noveheslo1', logOutOthers: true }
    expect(await changePasswordAction(db, me.id, here.token, wrong, IP, T0)).toStrictEqual({
      ok: false,
      error: 'wrong_password',
    })
  })

  it('an unknown token throws Unauthorized', async () => {
    const { db, me } = setup(true)
    await expect(
      changePasswordAction(db, me.id, 'x'.repeat(43), data(true), IP, T0),
    ).rejects.toThrow('Unauthorized')
    expect(hashOf(db, me.id)).toBe(OLD_HASH)
  })

  it("another user's live session throws Unauthorized and changes nothing", async () => {
    const { db, me, other, theirs } = setup(true)
    await expect(changePasswordAction(db, me.id, theirs.token, data(true), IP, T0)).rejects.toThrow(
      'Unauthorized',
    )
    expect(hashOf(db, me.id)).toBe(OLD_HASH)
    expect(hashOf(db, other.id)).toBe(OLD_HASH)
    expect(count(db, sessions)).toBe(3)
  })
})
