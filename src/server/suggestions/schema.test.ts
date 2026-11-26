import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { suggestions } from '~/server/db/schema'
import { family } from '~/server/tasks/testing'

// The DB backs up the suggestion rules (spec §5.13): never deleted, done and dismissed are final,
// the author's text and the sent text never change, and the sent fields match the state.
const AT = '2026-11-26T10:00:00.000Z'
const SENT = {
  issueUrl: 'https://github.com/SlatinskyJ/taskmaster/issues/300',
  issueNumber: 300,
  sentTitle: 'Tmavý režim',
  sentBody: 'Body',
  sentAt: AT,
}

function setup() {
  const f = family()
  const insert = (values: Partial<typeof suggestions.$inferInsert> = {}) =>
    f.db
      .insert(suggestions)
      .values({ authorId: f.starsi, title: 'Tmavý režim', createdAt: AT, status: 'new', ...values })
      .returning()
      .get().id
  const update = (id: number, set: Partial<typeof suggestions.$inferInsert>) =>
    f.db.update(suggestions).set(set).where(eq(suggestions.id, id)).run()
  return { ...f, insert, update }
}

describe('suggestions table', () => {
  it('refuses a delete', () => {
    const f = setup()
    const id = f.insert()
    expect(() => f.db.delete(suggestions).where(eq(suggestions.id, id)).run()).toThrow()
  })

  it('refuses any update of a done or dismissed row', () => {
    const f = setup()
    const done = f.insert({ status: 'done', closedBy: f.admin, closedAt: AT })
    const dismissed = f.insert({ status: 'dismissed', closedBy: f.admin, closedAt: AT })
    expect(() => f.update(done, { closedAt: '2026-11-27T10:00:00.000Z' })).toThrow()
    expect(() => f.update(dismissed, { status: 'new', closedBy: null, closedAt: null })).toThrow()
  })

  it("refuses changing the author's text", () => {
    const f = setup()
    const id = f.insert({ description: 'Popis' })
    expect(() => f.update(id, { title: 'Jiný' })).toThrow()
    expect(() => f.update(id, { description: 'Jiný' })).toThrow()
    expect(() => f.update(id, { description: null })).toThrow()
    expect(() => f.update(id, { authorId: f.mladsi })).toThrow()
    expect(() => f.update(id, { createdAt: '2026-11-27T10:00:00.000Z' })).toThrow()
  })

  it('refuses changing the sent fields once set', () => {
    const f = setup()
    const id = f.insert({ status: 'sent', ...SENT })
    expect(() => f.update(id, { sentTitle: 'Jiný' })).toThrow()
    expect(() => f.update(id, { sentBody: 'Jiný' })).toThrow()
    expect(() => f.update(id, { issueNumber: 301 })).toThrow()
    expect(() => f.update(id, { issueUrl: `${SENT.issueUrl}1` })).toThrow()
    expect(() => f.update(id, { sentAt: '2026-11-27T10:00:00.000Z' })).toThrow()
  })

  it('refuses a sent row without an issue url', () => {
    const f = setup()
    expect(() => f.insert({ status: 'sent', ...SENT, issueUrl: null })).toThrow()
    expect(() => f.insert({ status: 'sent' })).toThrow()
    expect(() => f.insert({ status: 'new', ...SENT })).toThrow()
  })

  it('refuses moving a sent row back to new', () => {
    const f = setup()
    const id = f.insert({ status: 'sent', ...SENT })
    expect(() => f.update(id, { status: 'new' })).toThrow()
    expect(() => f.update(id, { status: 'dismissed', closedBy: f.admin, closedAt: AT })).toThrow()
  })

  it('refuses a title over 120 or a description over 2000 characters', () => {
    const f = setup()
    expect(() => f.insert({ title: 'a'.repeat(121) })).toThrow()
    expect(() => f.insert({ title: '' })).toThrow()
    expect(() => f.insert({ description: 'a'.repeat(2001) })).toThrow()
    expect(() => f.insert({ description: '' })).toThrow()
  })

  it('refuses a state outside the list and closing fields that do not match the state', () => {
    const f = setup()
    expect(() =>
      f.db.run(sql`INSERT INTO suggestions (author_id, title, created_at, status)
      VALUES (${f.starsi}, 'x', ${AT}, 'open')`),
    ).toThrow()
    expect(() => f.insert({ status: 'done' })).toThrow()
    expect(() => f.insert({ closedBy: f.admin, closedAt: AT })).toThrow()
  })

  it('stores a title of exactly 120 and a description of exactly 2000 characters, counted as code points', () => {
    const f = setup()
    const id = f.insert({ title: '😀'.repeat(120), description: '😀'.repeat(2000) })
    const row = f.db.select().from(suggestions).where(eq(suggestions.id, id)).get()
    expect(row?.title).toBe('😀'.repeat(120))
    expect(row?.description).toBe('😀'.repeat(2000))
  })

  it('lets a new row be sent and then done, and a new row be done or dismissed', () => {
    const f = setup()
    const a = f.insert()
    f.update(a, { status: 'sent', ...SENT })
    f.update(a, { status: 'done', closedBy: f.admin, closedAt: AT })
    const b = f.insert()
    f.update(b, { status: 'dismissed', closedBy: f.admin, closedAt: AT })
    const statuses = f.db.select({ s: suggestions.status }).from(suggestions).all()
    expect(statuses.map((r) => r.s)).toEqual(['done', 'dismissed'])
  })
})
