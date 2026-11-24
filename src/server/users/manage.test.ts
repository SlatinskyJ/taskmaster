import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createSession } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { auditLog, sessions, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { failAuditOn } from '~/server/tasks/testing'
import { createUser, setOwnPasswordHash } from './manage'

// setOwnPasswordHash: the writer behind "Změnit heslo" on Profil (#210, spec §6).

const OLD = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$b2xkb2xkb2xkb2xk'
const NEW = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$bmV3bmV3bmV3bmV3'
const T0 = new Date('2026-11-24T10:00:00.000Z')
const T1 = new Date('2026-11-24T11:00:00.000Z')

function setup(db: Db = createTestDb()) {
  const add = (username: string) => {
    const r = createUser(
      db,
      { kind: 'system' },
      { username, displayName: username, role: 'taker', passwordHash: OLD },
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
  const me = add('starsi')
  const other = add('mladsi')
  const here = createSession(db, me.id, 'password', T0).session
  const phone = createSession(db, me.id, 'password', T0).session
  const theirs = createSession(db, other.id, 'password', T0).session
  return { db, me, other, here, phone, theirs }
}

const sessionIds = (db: Db) =>
  db
    .select({ id: sessions.id })
    .from(sessions)
    .all()
    .map((s) => s.id)
const hashOf = (db: Db, id: number) =>
  db.select().from(users).where(eq(users.id, id)).get()?.passwordHash
const updates = (db: Db) =>
  db.select().from(auditLog).where(eq(auditLog.action, 'user.updated')).all()

describe('setOwnPasswordHash (#210)', () => {
  it('sets the hash and, when asked, ends only the other sessions of this user', () => {
    const { db, me, here, theirs } = setup()
    const r = db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, OLD, NEW, true, T1))
    expect(r).toEqual({ ok: true, value: { sessionsEnded: 1 } })
    expect(hashOf(db, me.id)).toBe(NEW)
    expect(sessionIds(db).sort()).toEqual([here.id, theirs.id].sort())
  })

  it('ends no session when the box is unticked', () => {
    const { db, me, here, phone, theirs } = setup()
    const r = db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, OLD, NEW, false, T1))
    expect(r).toEqual({ ok: true, value: { sessionsEnded: 0 } })
    expect(sessionIds(db).sort()).toEqual([here.id, phone.id, theirs.id].sort())
  })

  it('refuses when the hash changed since it was checked, writing nothing', () => {
    const { db, me, here } = setup()
    const r = db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, NEW, NEW, true, T1))
    expect(r).toEqual({ ok: false, error: 'changed' })
    expect(hashOf(db, me.id)).toBe(OLD)
    expect(sessionIds(db)).toHaveLength(3)
    expect(updates(db)).toHaveLength(0)
  })

  it('refuses when the calling session is gone, writing nothing', () => {
    const { db, me, here, theirs } = setup()
    db.delete(sessions).where(eq(sessions.id, here.id)).run()
    const r = db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, OLD, NEW, true, T1))
    expect(r).toEqual({ ok: false, error: 'changed' })
    expect(hashOf(db, me.id)).toBe(OLD)
    expect(sessionIds(db)).toHaveLength(2)
    // A session of another user is not "the calling session" either.
    const r2 = db.transaction((tx) => setOwnPasswordHash(tx, me.id, theirs.id, OLD, NEW, true, T1))
    expect(r2).toEqual({ ok: false, error: 'changed' })
    expect(hashOf(db, me.id)).toBe(OLD)
  })

  it('refuses a missing user and a malformed hash', () => {
    const { db, me, here } = setup()
    expect(
      db.transaction((tx) => setOwnPasswordHash(tx, 999, here.id, OLD, NEW, true, T1)),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(
      db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, OLD, 'plain', true, T1)),
    ).toEqual({ ok: false, error: 'invalid_hash' })
    expect(hashOf(db, me.id)).toBe(OLD)
  })

  it('logs user.updated by the user, with no password or hash in it', () => {
    const { db, me, here } = setup()
    db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, OLD, NEW, true, T1))
    const [row] = updates(db)
    expect(row?.actorKind).toBe('user')
    expect(row?.actorUserId).toBe(me.id)
    expect(row?.entityId).toBe(String(me.id))
    const after = JSON.parse(row?.after ?? 'null') as Record<string, unknown>
    expect(after).toMatchObject({ hashChanged: true, logOutOthers: true, sessionsEnded: 1 })
    const text = `${row?.before ?? ''}${row?.after ?? ''}`
    expect(text).not.toContain('argon2')
    expect(Object.keys(after).some((k) => /password/i.test(k))).toBe(false)
  })

  it('rolls the hash and the sessions back when the audit write fails', () => {
    const { db, me, here } = setup()
    failAuditOn(db, 'user.updated')
    expect(() =>
      db.transaction((tx) => setOwnPasswordHash(tx, me.id, here.id, OLD, NEW, true, T1)),
    ).toThrow()
    expect(hashOf(db, me.id)).toBe(OLD)
    expect(sessionIds(db)).toHaveLength(3)
  })
})
