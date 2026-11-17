import { verify } from '@node-rs/argon2'
import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import { auditLog, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { bootstrapAdmin } from '~/server/users'
import { DEMO_PASSWORD, describeDemo, seedDemo } from './seed'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const PREVIEW = { TASKMASTER_ENV: 'preview', NODE_ENV: 'production' }

describe('demo seed (#62)', () => {
  it('fills an empty preview database with one person per role, audit-logged', async () => {
    const db = createTestDb()
    expect(seedDemo(db, PREVIEW, T0)).toEqual({
      kind: 'seeded',
      usernames: ['admin', 'tata', 'starsi', 'mladsi'],
    })
    const rows = db.select().from(users).all()
    expect(rows.map((u) => [u.username, u.role, u.active])).toEqual([
      ['admin', 'admin', true],
      ['tata', 'giver', true],
      ['starsi', 'taker', true],
      ['mladsi', 'taker', true],
    ])
    expect(await verify(rows[0]?.passwordHash ?? '', DEMO_PASSWORD)).toBe(true)
    const log = db.select().from(auditLog).all()
    expect(log.map((r) => [r.action, r.actorKind])).toEqual(
      Array(4).fill(['user.created', 'system']),
    )
  })

  it('demo login works for every role', async () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    for (const username of ['admin', 'tata', 'starsi', 'mladsi']) {
      const r = await login(db, { username, password: DEMO_PASSWORD, ip: '127.0.0.1' }, T0)
      expect(r.ok).toBe(true)
    }
  })

  it('refuses without the preview flag (production, dev, anything else)', () => {
    for (const env of [
      {},
      { NODE_ENV: 'production' },
      { TASKMASTER_ENV: 'production' },
      { TASKMASTER_ENV: 'Preview' },
    ]) {
      const db = createTestDb()
      expect(seedDemo(db, env, T0)).toEqual({ kind: 'skipped', reason: 'not_preview' })
      expect(db.select().from(users).all()).toHaveLength(0)
    }
  })

  it('refuses a database that already has people, so a real one is never touched', () => {
    const db = createTestDb()
    bootstrapAdmin(db, { ADMIN_PASSWORD: 'correct horse battery' }, T0)
    const before = db.select().from(auditLog).all().length
    expect(seedDemo(db, PREVIEW, T0)).toEqual({ kind: 'skipped', reason: 'not_empty' })
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((u) => u.username),
    ).toEqual(['admin'])
    expect(db.select().from(auditLog).all()).toHaveLength(before)
  })

  it('a second boot seeds nothing more', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(seedDemo(db, PREVIEW, T0)).toEqual({ kind: 'skipped', reason: 'not_empty' })
    expect(db.select().from(users).all()).toHaveLength(4)
  })

  it('boot messages: silent outside previews, says the password inside', () => {
    expect(describeDemo({ kind: 'skipped', reason: 'not_preview' })).toBeNull()
    expect(describeDemo({ kind: 'skipped', reason: 'not_empty' })).toContain('not seeding')
    expect(describeDemo({ kind: 'seeded', usernames: ['admin'] })).toContain(DEMO_PASSWORD)
  })
})
