import { describe, expect, it } from 'vitest'
import { auditLog, templateThread } from '~/server/db/schema'
import { addGiver, failAuditOn, family, must, T1, T2, T3 } from '~/server/tasks/testing'
import { updateUser } from '~/server/users/manage'
import {
  acceptLowestBidOnTemplate,
  acceptOfferOnTemplate,
  bidOnTemplate,
  counterOnTemplate,
} from './scoreChange'
import { agreementOf, createTemplate } from './templates'
import { agreedTemplate, score, templateAudits, threadIds, threadRows } from './testing'

// Template score change (spec §5.1, runs like bidding §5.2; §5.10 audit).

function setup() {
  const f = family()
  const mama = addGiver(f)
  const id = agreedTemplate(f)
  return { ...f, mama, id }
}

type S = ReturnType<typeof setup>

/** The audit entries written by the score change (after the template's creation and agreement). */
const changeAudits = (s: S) =>
  templateAudits(s.db, s.id).filter(
    (a) => !['template.created', 'template.score_approved', 'template.agreed'].includes(a.action),
  )

const count = (s: S) => ({
  audit: s.db.select().from(auditLog).all().length,
  thread: s.db.select().from(templateThread).all().length,
})

describe('template score change', () => {
  it('each action returns the template row: old score after a bid or offer, new after an accept', () => {
    const s = setup()
    expect(must(bidOnTemplate(s.db, s.mladsi, s.id, 5, T1)).score).toBe(3)
    expect(must(counterOnTemplate(s.db, s.tata, s.id, 4, T1)).score).toBe(3)
    expect(must(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 5, T2)).score).toBe(5)
    must(counterOnTemplate(s.db, s.tata, s.id, 4, T2))
    expect(must(acceptOfferOnTemplate(s.db, s.starsi, s.id, 4, T3)).score).toBe(4)
  })

  it("a taker's bid is stored, the score stays", () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 5, T1))
    expect(score(s.db, s.id)).toBe(3)
    const [bid] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 5, null]])
    expect(changeAudits(s)).toEqual([
      {
        action: 'template.bid_placed',
        actor: s.starsi,
        kind: 'user',
        before: null,
        after: { entryId: bid, score: 5 },
      },
    ])
  })

  it('a re-bid replaces his open bid and logs both numbers', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 5, T1))
    must(bidOnTemplate(s.db, s.starsi, s.id, 4, T2))
    const [old, now] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 5, 'replaced'],
      ['taker', s.starsi, 4, null],
    ])
    expect(changeAudits(s).at(-1)).toEqual({
      action: 'template.bid_placed',
      actor: s.starsi,
      kind: 'user',
      before: { entryId: old, score: 5 },
      after: { entryId: now, score: 4 },
    })
  })

  it('a giver counters; a taker accepts the offer: score changes, every open row closes', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 6, T1))
    must(counterOnTemplate(s.db, s.tata, s.id, 4, T2))
    const [bid, offer] = threadIds(s.db, s.id)
    expect(score(s.db, s.id)).toBe(3)
    expect(changeAudits(s).at(-1)).toEqual({
      action: 'template.score_countered',
      actor: s.tata,
      kind: 'user',
      before: null,
      after: { entryId: offer, score: 4 },
    })
    const saved = must(acceptOfferOnTemplate(s.db, s.mladsi, s.id, 4, T3))
    expect(saved.score).toBe(4)
    expect(score(s.db, s.id)).toBe(4)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 6, 'closed'],
      ['giver', s.tata, 4, 'accepted'],
    ])
    expect(changeAudits(s).at(-1)).toEqual({
      action: 'template.score_changed',
      actor: s.mladsi,
      kind: 'user',
      before: { score: 3 },
      after: { score: 4, entryIds: [offer], closedIds: [bid], by: 'offer' },
    })
  })

  it('a giver accepts the lowest bid', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 4, T1))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 6, T1))
    const [low, high] = threadIds(s.db, s.id)
    must(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 4, T2))
    expect(score(s.db, s.id)).toBe(4)
    expect(threadRows(s.db, s.id).map((r) => r[3])).toEqual(['accepted', 'closed'])
    expect(changeAudits(s).at(-1)).toEqual({
      action: 'template.score_changed',
      actor: s.tata,
      kind: 'user',
      before: { score: 3 },
      after: { score: 4, entryIds: [low], closedIds: [high], by: 'bid' },
    })
  })

  it('a tie at the lowest bid accepts both bids, one score change', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 4, T1))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 4, T1))
    const ids = threadIds(s.db, s.id)
    must(acceptLowestBidOnTemplate(s.db, s.mama, s.id, 4, T2))
    expect(score(s.db, s.id)).toBe(4)
    const changes = changeAudits(s).filter((a) => a.action === 'template.score_changed')
    expect(changes).toEqual([
      {
        action: 'template.score_changed',
        actor: s.mama,
        kind: 'user',
        before: { score: 3 },
        after: { score: 4, entryIds: ids, closedIds: [], by: 'bid' },
      },
    ])
  })

  it('a giver countering at the lowest bid accepts it', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 5, T1))
    must(bidOnTemplate(s.db, s.starsi, s.id, 4, T1))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 6, T1))
    must(counterOnTemplate(s.db, s.tata, s.id, 4, T2))
    const [oldOffer, low, high, counter] = threadIds(s.db, s.id)
    expect(score(s.db, s.id)).toBe(4)
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 5, 'replaced'],
      ['taker', s.starsi, 4, 'accepted'],
      ['taker', s.mladsi, 6, 'closed'],
      ['giver', s.tata, 4, 'accepted'],
    ])
    expect(changeAudits(s).at(-1)).toEqual({
      action: 'template.score_changed',
      actor: s.tata,
      kind: 'user',
      before: { score: 3, replacedOffer: { entryId: oldOffer, score: 5 } },
      after: { score: 4, entryIds: [low, counter], closedIds: [high], by: 'counter' },
    })
  })

  it('Máma counters after Táta', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 5, T1))
    must(counterOnTemplate(s.db, s.mama, s.id, 6, T2))
    const [tata, mama] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 5, 'replaced'],
      ['giver', s.mama, 6, null],
    ])
    expect(changeAudits(s).at(-1)).toMatchObject({
      action: 'template.score_countered',
      actor: s.mama,
      before: { entryId: tata, score: 5 },
      after: { entryId: mama, score: 6 },
    })
    must(acceptOfferOnTemplate(s.db, s.starsi, s.id, 6, T3))
    expect(score(s.db, s.id)).toBe(6)
  })

  it('stale numbers are refused and write nothing', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 5, T1))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 4, T1))
    must(counterOnTemplate(s.db, s.tata, s.id, 7, T1))
    must(counterOnTemplate(s.db, s.mama, s.id, 8, T1))
    const before = count(s)
    expect(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 5, T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(acceptOfferOnTemplate(s.db, s.starsi, s.id, 7, T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(count(s)).toEqual(before)
    expect(score(s.db, s.id)).toBe(3)
  })

  it('refusals write nothing', () => {
    const s = setup()
    const proposed = must(
      createTemplate(
        s.db,
        s.tata,
        { title: 'Vynést koše', score: 4, approvalRequired: true, schedule: null, deadline: null },
        T1,
      ),
    ).id
    must(bidOnTemplate(s.db, s.starsi, s.id, 5, T1))
    const before = count(s)
    const err = (r: { ok: boolean; error?: string }) => (r.ok ? 'ok' : r.error)
    expect(err(bidOnTemplate(s.db, s.starsi, proposed, 5, T2))).toBe('not_agreed')
    expect(err(bidOnTemplate(s.db, s.tata, s.id, 5, T2))).toBe('not_a_taker')
    expect(err(bidOnTemplate(s.db, s.admin, s.id, 5, T2))).toBe('not_a_taker')
    expect(err(counterOnTemplate(s.db, s.starsi, s.id, 5, T2))).toBe('not_a_giver')
    expect(err(counterOnTemplate(s.db, s.admin, s.id, 6, T2))).toBe('not_a_giver')
    expect(err(acceptLowestBidOnTemplate(s.db, s.starsi, s.id, 5, T2))).toBe('not_a_giver')
    expect(err(acceptOfferOnTemplate(s.db, s.tata, s.id, 5, T2))).toBe('not_a_taker')
    expect(err(acceptOfferOnTemplate(s.db, s.starsi, s.id, 5, T2))).toBe('no_offer')
    expect(err(bidOnTemplate(s.db, s.mladsi, s.id, 3, T2))).toBe('same_score')
    expect(err(bidOnTemplate(s.db, s.mladsi, s.id, 0, T2))).toBe('invalid_score')
    expect(err(bidOnTemplate(s.db, s.mladsi, 999, 5, T2))).toBe('not_found')
    expect(err(counterOnTemplate(s.db, s.tata, 999, 5, T2))).toBe('not_found')
    expect(err(acceptLowestBidOnTemplate(s.db, s.tata, 999, 5, T2))).toBe('not_found')
    expect(err(acceptOfferOnTemplate(s.db, s.starsi, 999, 5, T2))).toBe('not_found')
    expect(count(s)).toEqual(before)
  })

  it("a deactivated taker's bid is ignored and closed at the acceptance", () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 2, T1))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 4, T1))
    must(updateUser(s.db, { kind: 'user', userId: s.admin }, s.starsi, { active: false }, T2))
    expect(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 2, T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    must(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 4, T3))
    expect(score(s.db, s.id)).toBe(4)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 2, 'closed'],
      ['taker', s.mladsi, 4, 'accepted'],
    ])
  })

  it('the next change starts empty after an acceptance', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 5, T1))
    must(counterOnTemplate(s.db, s.tata, s.id, 6, T1))
    must(acceptOfferOnTemplate(s.db, s.starsi, s.id, 6, T2))
    const saved = must(bidOnTemplate(s.db, s.mladsi, s.id, 4, T3))
    expect(agreementOf(s.db, saved)).toEqual({
      status: 'agreed',
      score: 6,
      change: { offer: null, bids: [{ by: s.mladsi, score: 4 }] },
    })
  })

  describe('a failed audit write rolls back', () => {
    it('the bid', () => {
      const s = setup()
      failAuditOn(s.db, 'template.bid_placed')
      const before = count(s)
      expect(() => bidOnTemplate(s.db, s.starsi, s.id, 5, T1)).toThrow(/audit down/)
      expect(count(s)).toEqual(before)
    })

    it('the counter', () => {
      const s = setup()
      must(counterOnTemplate(s.db, s.tata, s.id, 5, T1))
      failAuditOn(s.db, 'template.score_countered')
      const before = threadRows(s.db, s.id)
      expect(() => counterOnTemplate(s.db, s.mama, s.id, 6, T2)).toThrow(/audit down/)
      expect(threadRows(s.db, s.id)).toEqual(before)
    })

    it('the score change', () => {
      const s = setup()
      must(bidOnTemplate(s.db, s.starsi, s.id, 5, T1))
      must(counterOnTemplate(s.db, s.tata, s.id, 6, T1))
      failAuditOn(s.db, 'template.score_changed')
      const before = threadRows(s.db, s.id)
      expect(() => acceptOfferOnTemplate(s.db, s.starsi, s.id, 6, T2)).toThrow(/audit down/)
      expect(() => acceptLowestBidOnTemplate(s.db, s.tata, s.id, 5, T2)).toThrow(/audit down/)
      expect(() => counterOnTemplate(s.db, s.tata, s.id, 5, T2)).toThrow(/audit down/)
      expect(threadRows(s.db, s.id)).toEqual(before)
      expect(score(s.db, s.id)).toBe(3)
    })
  })
})
