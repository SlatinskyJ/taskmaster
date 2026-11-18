import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import { findSession } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { auditLog, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { addPerson, editPerson, resetPassword } from './admin'
import { createUser } from './manage'

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo'
const T0 = new Date('2026-11-18T10:00:00.000Z')
const T1 = new Date('2026-11-18T11:00:00.000Z')
const IP = '1.1.1.1'

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function setup() {
  const db = createTestDb()
  const sys = { kind: 'system' } as const
  const admin = must(
    createUser(
      db,
      sys,
      { username: 'admin', displayName: 'Admin', role: 'admin', passwordHash: HASH },
      T0,
    ),
  )
  const tata = must(
    createUser(db, sys, { username: 'tata', displayName: 'Táta', role: 'giver' }, T0),
  )
  return { db, admin, tata }
}

const counts = (db: Db) => ({
  users: db.select().from(users).all().length,
  audit: db.select().from(auditLog).all().length,
})
const pw = (n: number) => 'a'.repeat(n)

describe('admin console: people (spec §6)', () => {
  it('adds a taker who can then log in with the starting password', async () => {
    const { db, admin } = setup()
    const added = must(
      await addPerson(
        db,
        admin.id,
        { username: ' Kuba ', displayName: 'Kuba', role: 'taker', password: 'zahrada12' },
        T0,
      ),
    )
    expect(added).toEqual({
      id: expect.any(Number) as number,
      username: 'kuba',
      displayName: 'Kuba',
      role: 'taker',
      active: true,
    })
    const logged = await login(db, { username: 'kuba', password: 'zahrada12', ip: IP }, T1)
    expect(logged.ok).toBe(true)
    const created = db
      .select()
      .from(auditLog)
      .all()
      .find((r) => r.action === 'user.created' && r.entityId === String(added.id))
    expect(created?.actorUserId).toBe(admin.id)
    expect(JSON.stringify(created)).not.toContain('zahrada12')
    expect(JSON.stringify(created)).not.toContain('argon2')
  })

  it('password length is checked at both ends before anything is written', async () => {
    const { db, admin } = setup()
    const before = counts(db)
    for (const n of [7, 257]) {
      const r = await addPerson(
        db,
        admin.id,
        { username: `u${String(n)}`, displayName: 'X', role: 'taker', password: pw(n) },
        T0,
      )
      expect(r).toEqual({ ok: false, error: 'invalid_password' })
    }
    expect(counts(db)).toEqual(before)
    for (const n of [8, 256]) {
      const r = await addPerson(
        db,
        admin.id,
        { username: `u${String(n)}`, displayName: 'X', role: 'taker', password: pw(n) },
        T0,
      )
      expect(r.ok).toBe(true)
    }
  })

  it('a giver cannot add, edit or reset', async () => {
    const { db, tata, admin } = setup()
    const before = counts(db)
    const input = { username: 'kuba', displayName: 'Kuba', role: 'taker' as const, password: pw(8) }
    expect(await addPerson(db, tata.id, input, T0)).toEqual({ ok: false, error: 'not_admin' })
    expect(editPerson(db, tata.id, admin.id, { displayName: 'X' }, T0)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    expect(await resetPassword(db, tata.id, admin.id, pw(8), T0)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    expect(counts(db)).toEqual(before)
  })

  it('edit renames and changes role, returning the summary', () => {
    const { db, admin, tata } = setup()
    const edited = must(
      editPerson(db, admin.id, tata.id, { displayName: 'Taťka', role: 'taker' }, T0),
    )
    expect(edited).toEqual({
      id: tata.id,
      username: 'tata',
      displayName: 'Taťka',
      role: 'taker',
      active: true,
    })
    expect(edited).not.toHaveProperty('passwordHash')
  })

  it('the last admin cannot be demoted', () => {
    const { db, admin } = setup()
    expect(editPerson(db, admin.id, admin.id, { role: 'giver' }, T0)).toEqual({
      ok: false,
      error: 'last_admin',
    })
  })

  it("reset ends the person's sessions; old password fails, new works", async () => {
    const { db, admin } = setup()
    const kuba = must(
      await addPerson(
        db,
        admin.id,
        { username: 'kuba', displayName: 'Kuba', role: 'taker', password: 'stareheslo' },
        T0,
      ),
    )
    const session = must(await login(db, { username: 'kuba', password: 'stareheslo', ip: IP }, T0))
    const hashBefore = db
      .select()
      .from(users)
      .all()
      .find((u) => u.id === kuba.id)?.passwordHash

    for (const n of [7, 257]) {
      expect(await resetPassword(db, admin.id, kuba.id, pw(n), T1)).toEqual({
        ok: false,
        error: 'invalid_password',
      })
    }
    expect(
      db
        .select()
        .from(users)
        .all()
        .find((u) => u.id === kuba.id)?.passwordHash,
    ).toBe(hashBefore)
    expect(findSession(db, session.token)).toBeDefined()

    expect(await resetPassword(db, admin.id, kuba.id, 'noveheslo1', T1)).toEqual({
      ok: true,
      value: { id: kuba.id },
    })
    expect(findSession(db, session.token)).toBeUndefined()
    const old = await login(db, { username: 'kuba', password: 'stareheslo', ip: IP }, T1)
    expect(old).toEqual({ ok: false, error: 'invalid_credentials' })
    expect((await login(db, { username: 'kuba', password: 'noveheslo1', ip: IP }, T1)).ok).toBe(
      true,
    )
    expect((await resetPassword(db, admin.id, kuba.id, pw(8), T1)).ok).toBe(true)
  })

  it('bad username and taken username come back as errors', async () => {
    const { db, admin } = setup()
    const base = { displayName: 'X', role: 'taker' as const, password: pw(8) }
    expect(await addPerson(db, admin.id, { ...base, username: 'Žofie' }, T0)).toEqual({
      ok: false,
      error: 'invalid_username',
    })
    expect(await addPerson(db, admin.id, { ...base, username: 'tata' }, T0)).toEqual({
      ok: false,
      error: 'username_taken',
    })
  })
})
