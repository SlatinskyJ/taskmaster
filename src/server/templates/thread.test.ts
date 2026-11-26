import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Tx } from '~/server/audit'
import { templates } from '~/server/db/schema'
import { addGiver, family, T1, T2 } from '~/server/tasks/testing'
import { agreementOf } from './templates'
import { agreedTemplate, threadRows } from './testing'
import { addEntry, closeThread, lastBids, markBidsFrom, openRows } from './thread'

function setup() {
  const f = family()
  const mama = addGiver(f)
  const id = agreedTemplate(f)
  const tx = <T>(run: (tx: Tx) => T): T => f.db.transaction(run)
  const add = (userId: number, side: 'giver' | 'taker', score: number) =>
    tx((t) => addEntry(t, { templateId: id, userId, side, score }, T1))
  return { f, mama, id, tx, add }
}

const row = (s: ReturnType<typeof setup>) =>
  s.f.db.select().from(templates).where(eq(templates.id, s.id)).get()

describe('template thread rows', () => {
  it("a re-bid closes the taker's old bid as replaced and returns it", () => {
    const s = setup()
    const first = s.add(s.f.starsi, 'taker', 4)
    expect(first.replaced).toBeNull()
    const second = s.add(s.f.starsi, 'taker', 5)
    expect(second.replaced?.id).toBe(first.entry.id)
    expect(threadRows(s.f.db, s.id)).toEqual([
      ['taker', s.f.starsi, 4, 'replaced'],
      ['taker', s.f.starsi, 5, null],
    ])
  })

  it("Máma's offer replaces Táta's open offer", () => {
    const s = setup()
    const tata = s.add(s.f.tata, 'giver', 4)
    const mama = s.add(s.mama, 'giver', 5)
    expect(mama.replaced?.id).toBe(tata.entry.id)
    expect(threadRows(s.f.db, s.id)).toEqual([
      ['giver', s.f.tata, 4, 'replaced'],
      ['giver', s.mama, 5, null],
    ])
  })

  it('an offer does not close bids, and bids of two takers stand side by side', () => {
    const s = setup()
    s.add(s.f.starsi, 'taker', 4)
    s.add(s.f.mladsi, 'taker', 6)
    s.add(s.f.tata, 'giver', 5)
    expect(openRows(s.f.db, s.id)).toHaveLength(3)
  })

  it('closeThread accepts the given rows, closes the rest, leaves nothing open', () => {
    const s = setup()
    const bid = s.add(s.f.starsi, 'taker', 4).entry.id
    const other = s.add(s.f.mladsi, 'taker', 6).entry.id
    const offer = s.add(s.f.tata, 'giver', 5).entry.id
    const result = s.tx((t) => closeThread(t, s.id, [bid], T2))
    expect(result).toEqual({ accepted: [bid], closed: [other, offer] })
    expect(openRows(s.f.db, s.id)).toEqual([])
    expect(threadRows(s.f.db, s.id).map((r) => r[3])).toEqual(['accepted', 'closed', 'closed'])
  })

  it('markBidsFrom moves the floor to the newest row and returns it before and after (#232)', () => {
    const s = setup()
    const floor = () =>
      s.f.db.select().from(templates).where(eq(templates.id, s.id)).get()?.bidsFrom
    expect(s.tx((t) => markBidsFrom(t, s.id))).toEqual({ before: 0, after: 0 })
    s.add(s.f.starsi, 'taker', 4)
    const newest = s.add(s.f.mladsi, 'taker', 6).entry.id
    expect(s.tx((t) => markBidsFrom(t, s.id))).toEqual({ before: 0, after: newest })
    expect(floor()).toBe(newest)
    expect(lastBids(s.f.db, s.id, newest)).toEqual([])
  })

  it('agreementOf reads the open offer and bids as the change in flight', () => {
    const s = setup()
    const active = row(s)
    if (!active) throw new Error('no template')
    expect(agreementOf(s.f.db, active)).toEqual({
      status: 'agreed',
      score: 3,
      change: null,
      lastBids: [],
    })
    s.add(s.f.starsi, 'taker', 4)
    s.add(s.f.mladsi, 'taker', 6)
    s.add(s.f.tata, 'giver', 5)
    expect(agreementOf(s.f.db, active)).toEqual({
      status: 'agreed',
      score: 3,
      change: {
        offer: { score: 5, proposedBy: s.f.tata },
        bids: [
          { by: s.f.starsi, score: 4 },
          { by: s.f.mladsi, score: 6 },
        ],
      },
      // The newer giver row is the floor: neither bid blocks its number (#232).
      lastBids: [],
    })
  })

  it('agreementOf with only bids has no offer', () => {
    const s = setup()
    s.add(s.f.starsi, 'taker', 4)
    const active = row(s)
    if (!active) throw new Error('no template')
    expect(agreementOf(s.f.db, active)).toEqual({
      status: 'agreed',
      score: 3,
      change: { offer: null, bids: [{ by: s.f.starsi, score: 4 }] },
      lastBids: [{ by: s.f.starsi, score: 4 }],
    })
  })
})

describe('last bids for the same-number rule (#209)', () => {
  const pairs = (rows: { userId: number; score: number }[]) => rows.map((r) => [r.userId, r.score])

  it('lastBids counts from the newest giver row, closed bids included', () => {
    const s = setup()
    s.add(s.f.starsi, 'taker', 4)
    s.add(s.f.tata, 'giver', 5)
    const bid = s.add(s.f.starsi, 'taker', 6)
    s.add(s.f.mladsi, 'taker', 7)
    s.tx((t) => closeThread(t, s.id, [], T2))
    // Starší's 4 is before the counter; his 6 counts though closed, as does Mladší's 7.
    expect(pairs(lastBids(s.f.db, s.id))).toEqual([
      [s.f.starsi, 6],
      [s.f.mladsi, 7],
    ])
    expect(bid.entry.closedAt).toBeNull()
  })

  it('lastBids with since ignores bids at or below it', () => {
    const s = setup()
    const first = s.add(s.f.starsi, 'taker', 4)
    s.add(s.f.mladsi, 'taker', 7)
    expect(pairs(lastBids(s.f.db, s.id, first.entry.id))).toEqual([[s.f.mladsi, 7]])
    expect(pairs(lastBids(s.f.db, s.id))).toEqual([
      [s.f.starsi, 4],
      [s.f.mladsi, 7],
    ])
  })
})
