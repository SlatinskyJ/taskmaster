import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getFlags } from '~/server/features'
import { family } from '~/server/tasks/testing'
import { disputes } from './schema'

// The DB backs up the dispute rules (spec §5.11, #46): at most one open dispute per item, a
// reason of 1–1000 characters, an open row has no resolution and a closed one has all of it,
// rows are never deleted and a closed one is final.
const AT = '2026-11-22T12:00:00.000Z'

function setup() {
  const f = family()
  const open = {
    itemKind: 'completion' as const,
    itemId: 5,
    openedBy: f.starsi,
    reason: 'Vysával jsem i kufr.',
    openedAt: AT,
    status: 'open' as const,
  }
  const dismissed = {
    ...open,
    status: 'dismissed' as const,
    resolvedBy: f.admin,
    resolvedAt: AT,
    note: 'Body sedí.',
  }
  return { ...f, open, dismissed }
}

describe('disputes table', () => {
  it('a second open dispute on the same item is refused', () => {
    const { db, open } = setup()
    db.insert(disputes).values(open).run()
    expect(() => db.insert(disputes).values(open).run()).toThrow(/UNIQUE/)
  })

  it('an open and a closed dispute on the same item both store', () => {
    const { db, open, dismissed } = setup()
    db.insert(disputes).values(dismissed).run()
    db.insert(disputes).values(open).run()
    expect(db.select().from(disputes).all()).toHaveLength(2)
  })

  it('the same id under another kind is another item', () => {
    const { db, open } = setup()
    db.insert(disputes).values(open).run()
    db.insert(disputes)
      .values({ ...open, itemKind: 'rejection' })
      .run()
    expect(db.select().from(disputes).all()).toHaveLength(2)
  })

  it('reason: 1–1000 characters after trimming', () => {
    const { db, open } = setup()
    expect(() =>
      db
        .insert(disputes)
        .values({ ...open, reason: '' })
        .run(),
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .insert(disputes)
        .values({ ...open, reason: '   ' })
        .run(),
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .insert(disputes)
        .values({ ...open, reason: 'a'.repeat(1001) })
        .run(),
    ).toThrow(/CHECK/)
    db.insert(disputes)
      .values({ ...open, reason: 'a'.repeat(1000) })
      .run()
  })

  it.each([
    ['note', { note: 'x' }],
    ['resolved_by', { resolvedBy: 1 }],
    ['resolved_at', { resolvedAt: AT }],
  ])('an open row with %s is refused', (_, extra) => {
    const { db, open } = setup()
    expect(() =>
      db
        .insert(disputes)
        .values({ ...open, ...extra })
        .run(),
    ).toThrow(/CHECK/)
  })

  it.each([
    ['note', { note: null }],
    ['a blank note', { note: '  ' }],
    ['resolved_by', { resolvedBy: null }],
    ['resolved_at', { resolvedAt: null }],
  ])('a dismissed row without %s is refused', (_, missing) => {
    const { db, dismissed } = setup()
    expect(() =>
      db
        .insert(disputes)
        .values({ ...dismissed, ...missing })
        .run(),
    ).toThrow(/CHECK/)
  })

  it('an unknown kind or status is refused', () => {
    const { db, open } = setup()
    expect(() =>
      db
        .insert(disputes)
        .values({ ...open, itemKind: 'task' as never })
        .run(),
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .insert(disputes)
        .values({ ...open, status: 'withdrawn' as never })
        .run(),
    ).toThrow(/CHECK/)
  })

  it('rows are never deleted', () => {
    const { db, open } = setup()
    db.insert(disputes).values(open).run()
    expect(() => db.delete(disputes).run()).toThrow(/never deleted/)
  })

  it('an open dispute closes once; a closed one is final', () => {
    const { db, open, admin } = setup()
    const { id } = db.insert(disputes).values(open).returning().get()
    db.update(disputes)
      .set({ status: 'dismissed', resolvedBy: admin, resolvedAt: AT, note: 'Body sedí.' })
      .where(eq(disputes.id, id))
      .run()
    expect(() =>
      db.update(disputes).set({ note: 'Jinak.' }).where(eq(disputes.id, id)).run(),
    ).toThrow(/final/)
  })

  it('the disputes switch is off on a fresh database', () => {
    const { db } = setup()
    expect(getFlags(db).disputes).toBe(false)
  })
})
