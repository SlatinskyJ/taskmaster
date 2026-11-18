import { describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { createUserAction, resetPasswordAction, updateUserAction } from './actions'
import { createUser } from './manage'

// What each people server function does with its parsed input (./functions is one call each).
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo'
const T0 = new Date('2026-11-18T10:00:00.000Z')

function setup() {
  const db = createTestDb()
  const sys = { kind: 'system' } as const
  const add = (username: string, role: 'admin' | 'giver' | 'taker') => {
    const r = createUser(db, sys, { username, displayName: username, role, passwordHash: HASH }, T0)
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
  return {
    db,
    admin: add('admin', 'admin'),
    admin2: add('admin2', 'admin'),
    tata: add('tata', 'giver'),
  }
}
const row = (db: Db, id: number) =>
  db
    .select()
    .from(users)
    .all()
    .find((u) => u.id === id)

describe('people server function actions', () => {
  it('create returns the new person only', async () => {
    const { db, admin } = setup()
    const r = await createUserAction(
      db,
      admin.id,
      { username: 'kuba', displayName: 'Kuba', role: 'giver', password: 'zahrada12' },
      T0,
    )
    expect(r).toEqual({
      ok: true,
      person: {
        id: expect.any(Number) as number,
        username: 'kuba',
        displayName: 'Kuba',
        role: 'giver',
        active: true,
      },
    })
  })

  it('update changes the target, not the caller', () => {
    const { db, admin, tata } = setup()
    const r = updateUserAction(
      db,
      admin.id,
      { userId: tata.id, displayName: 'Taťka', role: 'taker' },
      T0,
    )
    expect(r).toMatchObject({
      ok: true,
      person: { id: tata.id, displayName: 'Taťka', role: 'taker' },
    })
    expect(row(db, admin.id)?.displayName).toBe('admin')
    expect(row(db, admin.id)?.role).toBe('admin')
  })

  it('reset changes the target password only', async () => {
    const { db, admin, admin2 } = setup()
    expect(
      await resetPasswordAction(db, admin.id, { userId: admin2.id, password: 'noveheslo1' }, T0),
    ).toEqual({
      ok: true,
    })
    expect(row(db, admin2.id)?.passwordHash).not.toBe(HASH)
    expect(row(db, admin.id)?.passwordHash).toBe(HASH)
  })

  it('refusals come back as errors', async () => {
    const { db, tata } = setup()
    expect(
      await resetPasswordAction(db, tata.id, { userId: tata.id, password: 'noveheslo1' }, T0),
    ).toEqual({
      ok: false,
      error: 'not_admin',
    })
  })
})
