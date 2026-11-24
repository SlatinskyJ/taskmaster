import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { auditLog, templates, templateScoreApprovals, templateThread } from '~/server/db/schema'
import { createOnDemandInstance } from '~/server/instances/instances'
import { addGiver, failAuditOn, family, must, T0, T1, T2, T3 } from '~/server/tasks/testing'
import { updateUser } from '~/server/users/manage'
import {
  acceptLowestBidOnTemplate,
  acceptOfferOnTemplate,
  bidOnTemplate,
  counterOnTemplate,
  turnDownTemplateBids,
  withdrawTemplateBid,
} from './scoreChange'
import { agreementOf, approveTemplateScore, createTemplate } from './templates'
import { agreedTemplate, templateAudits, threadIds, threadRows } from './testing'

// Bidding on a proposed chore's first score (#209, spec §5.1): the one-time rules, no reservation.

const on = { choreBidding: true, bidRefusals: false }

/** "Vynést koš", proposed by Táta at 10 (his approval in offer round 1). */
function setup() {
  const f = family()
  const mama = addGiver(f)
  const input = { title: 'Vynést koš', score: 10, approvalRequired: true }
  const id = must(createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0)).id
  return { ...f, mama, id }
}

type S = ReturnType<typeof setup>

const row = (s: S) => {
  const r = s.db.select().from(templates).where(eq(templates.id, s.id)).get()
  if (!r) throw new Error('no template')
  return r
}

const approvals = (s: S) =>
  s.db
    .select()
    .from(templateScoreApprovals)
    .where(eq(templateScoreApprovals.templateId, s.id))
    .all()
    .map((a) => [a.offerRound, a.userId, a.score])

/** Audit entries after the template's creation. */
const audits = (s: S) => templateAudits(s.db, s.id).filter((a) => a.action !== 'template.created')

const snapshot = (s: S) => ({
  audit: s.db.select().from(auditLog).all().length,
  thread: s.db.select().from(templateThread).all().length,
  approvals: approvals(s),
  template: row(s),
})

describe('bidding on a proposed chore: switch off (#209)', () => {
  const actions: [string, (s: S) => unknown][] = [
    ['bid', (s) => bidOnTemplate(s.db, s.starsi, s.id, 12, T1)],
    ['counter', (s) => counterOnTemplate(s.db, s.tata, s.id, 12, T1)],
    ['accept lowest', (s) => acceptLowestBidOnTemplate(s.db, s.tata, s.id, 12, T1)],
    ['accept offer', (s) => acceptOfferOnTemplate(s.db, s.starsi, s.id, 10, T1)],
    ['Nechci', (s) => withdrawTemplateBid(s.db, s.starsi, s.id, T1)],
    ['turn-down', (s) => turnDownTemplateBids(s.db, s.tata, s.id, [], T1)],
  ]

  it.each(actions)('%s answers not_agreed and writes nothing', (_, act) => {
    const s = setup()
    const before = snapshot(s)
    expect(act(s)).toEqual({ ok: false, error: 'not_agreed' })
    expect(snapshot(s)).toEqual(before)
  })
})

describe('bidding on a proposed chore: switch on (#209)', () => {
  it('a bid writes a taker row and template.bid_placed; the template stays proposed at 10', () => {
    const s = setup()
    expect(must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))).toMatchObject({
      status: 'proposed',
      score: 10,
    })
    const [bid] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 12, null]])
    expect(audits(s)).toEqual([
      {
        action: 'template.bid_placed',
        actor: s.starsi,
        kind: 'user',
        before: null,
        after: { entryId: bid, score: 12 },
      },
    ])
    expect(row(s)).toMatchObject({ status: 'proposed', score: 10, offerRound: 1 })
  })

  it("Nechci closes only his bid: Mladší's stays open; his same number again is same_score", () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 14, T1, on))
    must(withdrawTemplateBid(s.db, s.starsi, s.id, T2, on))
    const [his] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 12, 'closed'],
      ['taker', s.mladsi, 14, null],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.bid_withdrawn',
      actor: s.starsi,
      kind: 'user',
      before: { entryId: his, score: 12 },
      after: null,
    })
    expect(bidOnTemplate(s.db, s.starsi, s.id, 12, T3, on)).toEqual({
      ok: false,
      error: 'same_score',
    })
    expect(withdrawTemplateBid(s.db, s.starsi, s.id, T3, on)).toEqual({
      ok: false,
      error: 'no_bid',
    })
  })

  it('Nechci finds his own bid when it is not the oldest open row', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 11, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 14, T1, on))
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(withdrawTemplateBid(s.db, s.starsi, s.id, T2, on))
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 11, null],
      ['taker', s.mladsi, 14, null],
      ['taker', s.starsi, 12, 'closed'],
    ])
  })

  it('a turn-down closes the bids, re-offers 10 in round 2 with his approval; the number is free again', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 14, T1, on))
    const seen = [
      { takerId: s.starsi, score: 12 },
      { takerId: s.mladsi, score: 14 },
    ]
    const saved = must(turnDownTemplateBids(s.db, s.tata, s.id, seen, T2, on))
    expect(saved).toMatchObject({ status: 'proposed', score: 10, offerRound: 2 })
    const [b1, b2, offer] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 12, 'closed'],
      ['taker', s.mladsi, 14, 'closed'],
      ['giver', s.tata, 10, null],
    ])
    expect(approvals(s)).toEqual([
      [1, s.tata, 10],
      [2, s.tata, 10],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.bids_turned_down',
      actor: s.tata,
      kind: 'user',
      before: { score: 10, offerRound: 1, entryIds: [b1, b2], bidsFrom: 0 },
      after: { score: 10, offerRound: 2, entryId: offer, bidsFrom: offer },
    })
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T3, on))
  })

  it('a turn-down after a counter logs the replaced counter row', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 11, T1, on))
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(turnDownTemplateBids(s.db, s.tata, s.id, [{ takerId: s.starsi, score: 12 }], T2, on))
    const [counter, bid, offer] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 11, 'replaced'],
      ['taker', s.starsi, 12, 'closed'],
      ['giver', s.tata, 11, null],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.bids_turned_down',
      actor: s.tata,
      kind: 'user',
      before: {
        score: 11,
        offerRound: 2,
        entryIds: [bid],
        replacedOffer: { entryId: counter, score: 11 },
        bidsFrom: 0,
      },
      after: { score: 11, offerRound: 3, entryId: offer, bidsFrom: offer },
    })
  })

  it('a turn-down with other bids than he saw is offer_changed and writes nothing', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 14, T1, on))
    const before = snapshot(s)
    const seen = [{ takerId: s.starsi, score: 12 }]
    expect(turnDownTemplateBids(s.db, s.tata, s.id, seen, T2, on)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(snapshot(s)).toEqual(before)
  })

  it("a counter moves the offer to round 2; a brother's Souhlasím at it agrees, the counter row accepted", () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 14, T1, on))
    must(counterOnTemplate(s.db, s.tata, s.id, 11, T1, on))
    must(counterOnTemplate(s.db, s.tata, s.id, 12, T2, on))
    expect(row(s)).toMatchObject({ status: 'proposed', score: 12, offerRound: 3 })
    const [bid, first, second] = threadIds(s.db, s.id)
    expect(approvals(s)).toEqual([
      [1, s.tata, 10],
      [2, s.tata, 11],
      [3, s.tata, 12],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.score_countered',
      actor: s.tata,
      kind: 'user',
      before: { score: 11, offerRound: 2, replacedOffer: { entryId: first, score: 11 } },
      after: { score: 12, offerRound: 3, entryId: second },
    })
    // Mladší, who never bid, agrees at the offer (path 1).
    expect(must(approveTemplateScore(s.db, s.mladsi, s.id, 12, T3))).toMatchObject({
      status: 'active',
      score: 12,
    })
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 14, 'closed'],
      ['giver', s.tata, 11, 'replaced'],
      ['giver', s.tata, 12, 'accepted'],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.agreed',
      actor: s.mladsi,
      kind: 'user',
      before: { status: 'proposed', score: 12, bidsFrom: 0 },
      after: {
        status: 'active',
        score: 12,
        by: 'approval',
        entryIds: [second],
        closedIds: [bid],
        bidsFrom: second,
      },
    })
  })

  it('a second giver approves after a counter: a new round-2 row, no clash', () => {
    const s = setup()
    must(approveTemplateScore(s.db, s.mama, s.id, 10, T1))
    must(counterOnTemplate(s.db, s.tata, s.id, 12, T1, on))
    expect(approveTemplateScore(s.db, s.mama, s.id, 10, T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    must(approveTemplateScore(s.db, s.mama, s.id, 12, T2))
    expect(approvals(s)).toEqual([
      [1, s.tata, 10],
      [1, s.mama, 10],
      [2, s.tata, 12],
      [2, s.mama, 12],
    ])
    const agreement = agreementOf(s.db, row(s))
    expect(agreement.status === 'proposed' && agreement.proposal.approvedBy).toEqual([
      s.tata,
      s.mama,
    ])
  })

  it('accept lowest: active at the lowest, bids at it accepted, the rest closed, agreed by bid', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 14, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 12, T1, on))
    expect(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 14, T2, on)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(must(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 12, T2, on))).toMatchObject({
      status: 'active',
      score: 12,
      agreedAt: T2.toISOString(),
    })
    const [high, low] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 14, 'closed'],
      ['taker', s.mladsi, 12, 'accepted'],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.agreed',
      actor: s.tata,
      kind: 'user',
      before: { status: 'proposed', score: 10, bidsFrom: 0 },
      after: {
        status: 'active',
        score: 12,
        by: 'bid',
        entryIds: [low],
        closedIds: [high],
        bidsFrom: low,
      },
    })
    expect(agreementOf(s.db, row(s))).toEqual({
      status: 'agreed',
      score: 12,
      change: null,
      lastBids: [],
    })
  })

  it('a tie at the lowest agrees too, both bids accepted', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 12, T1, on))
    must(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 12, T2, on))
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 12, 'accepted'],
      ['taker', s.mladsi, 12, 'accepted'],
    ])
    expect(row(s)).toMatchObject({ status: 'active', score: 12 })
  })

  it('a counter at a bid that replaces an earlier counter logs the replaced row', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 11, T1, on))
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(counterOnTemplate(s.db, s.mama, s.id, 12, T2, on))
    const [first, bid, counter] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 11, 'replaced'],
      ['taker', s.starsi, 12, 'accepted'],
      ['giver', s.mama, 12, 'accepted'],
    ])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.agreed',
      actor: s.mama,
      kind: 'user',
      before: {
        status: 'proposed',
        score: 11,
        replacedOffer: { entryId: first, score: 11 },
        bidsFrom: 0,
      },
      after: {
        status: 'active',
        score: 12,
        by: 'counter',
        entryIds: [bid, counter],
        closedIds: [],
        bidsFrom: counter,
      },
    })
  })

  it('a counter at an open bid agrees at it, counter and bid rows accepted', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(bidOnTemplate(s.db, s.mladsi, s.id, 14, T1, on))
    expect(must(counterOnTemplate(s.db, s.mama, s.id, 12, T2, on))).toMatchObject({
      status: 'active',
      score: 12,
    })
    const [b12, b14, counter] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 12, 'accepted'],
      ['taker', s.mladsi, 14, 'closed'],
      ['giver', s.mama, 12, 'accepted'],
    ])
    expect(audits(s).at(-1)).toMatchObject({
      action: 'template.agreed',
      actor: s.mama,
      after: {
        status: 'active',
        score: 12,
        by: 'counter',
        entryIds: [b12, counter],
        closedIds: [b14],
      },
    })
  })

  it("a bidder's yes agrees at the offer; one without a bid is no_bid", () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 11, T1, on))
    must(bidOnTemplate(s.db, s.starsi, s.id, 13, T1, on))
    expect(acceptOfferOnTemplate(s.db, s.mladsi, s.id, 11, T2, on)).toEqual({
      ok: false,
      error: 'no_bid',
    })
    expect(acceptOfferOnTemplate(s.db, s.starsi, s.id, 10, T2, on)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    must(acceptOfferOnTemplate(s.db, s.starsi, s.id, 11, T2, on))
    const [offer, bid] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 11, 'accepted'],
      ['taker', s.starsi, 13, 'closed'],
    ])
    expect(audits(s).at(-1)).toMatchObject({
      action: 'template.agreed',
      actor: s.starsi,
      after: { status: 'active', score: 11, by: 'offer', entryIds: [offer], closedIds: [bid] },
    })
  })

  it('path-1 agreement closes the first-price bids', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    must(approveTemplateScore(s.db, s.mladsi, s.id, 10, T2))
    expect(row(s)).toMatchObject({ status: 'active', score: 10 })
    expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 12, 'closed']])
    // Bids reset on agreement (#232): his closed first-price 12 no longer counts.
    expect(agreementOf(s.db, row(s))).toEqual({
      status: 'agreed',
      score: 10,
      change: null,
      lastBids: [],
    })
  })

  it('people change activating a proposed template closes its bids', () => {
    const s = setup()
    must(approveTemplateScore(s.db, s.mama, s.id, 10, T1))
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    // Máma becomes a taker: Táta (giver) and Máma (taker) both approved 10.
    must(updateUser(s.db, { kind: 'user', userId: s.admin }, s.mama, { role: 'taker' }, T2))
    expect(row(s)).toMatchObject({ status: 'active', score: 10 })
    const [bid] = threadIds(s.db, s.id)
    expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 12, 'closed']])
    expect(audits(s).at(-1)).toEqual({
      action: 'template.agreed',
      actor: null,
      kind: 'system',
      before: { status: 'proposed', score: 10, bidsFrom: 0 },
      after: {
        status: 'active',
        score: 10,
        by: 'approval',
        entryIds: [],
        closedIds: [bid],
        bidsFrom: bid,
      },
    })
    expect(agreementOf(s.db, row(s))).toEqual({
      status: 'agreed',
      score: 10,
      change: null,
      lastBids: [],
    })
  })

  it('wrong actor: a giver bids, a taker counters or turns down; nothing is written', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    const before = snapshot(s)
    const seen = [{ takerId: s.starsi, score: 12 }]
    expect(bidOnTemplate(s.db, s.tata, s.id, 11, T2, on)).toEqual({
      ok: false,
      error: 'not_a_taker',
    })
    expect(withdrawTemplateBid(s.db, s.tata, s.id, T2, on)).toEqual({
      ok: false,
      error: 'not_a_taker',
    })
    expect(counterOnTemplate(s.db, s.mladsi, s.id, 11, T2, on)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(turnDownTemplateBids(s.db, s.mladsi, s.id, seen, T2, on)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(acceptLowestBidOnTemplate(s.db, s.admin, s.id, 12, T2, on)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(snapshot(s)).toEqual(before)
  })

  it('withdraw and turn-down on an active template are not_proposed', () => {
    const f = family()
    const id = agreedTemplate(f)
    must(bidOnTemplate(f.db, f.starsi, id, 5, T1, on))
    expect(withdrawTemplateBid(f.db, f.starsi, id, T2, on)).toEqual({
      ok: false,
      error: 'not_proposed',
    })
    const seen = [{ takerId: f.starsi, score: 5 }]
    expect(turnDownTemplateBids(f.db, f.tata, id, seen, T2, on)).toEqual({
      ok: false,
      error: 'not_proposed',
    })
  })

  it('a missing template is not_found', () => {
    const s = setup()
    expect(withdrawTemplateBid(s.db, s.starsi, 999, T1, on)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(turnDownTemplateBids(s.db, s.tata, 999, [], T1, on)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('instances: a proposed template with bids makes none', () => {
    const s = setup()
    must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
    expect(createOnDemandInstance(s.db, s.tata, s.id, T2).ok).toBe(false)
  })

  describe('an audit failure rolls back the whole action', () => {
    it('the bid', () => {
      const s = setup()
      failAuditOn(s.db, 'template.bid_placed')
      const before = snapshot(s)
      expect(() => bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on)).toThrow(/audit down/)
      expect(snapshot(s)).toEqual(before)
    })

    it('Nechci', () => {
      const s = setup()
      must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
      failAuditOn(s.db, 'template.bid_withdrawn')
      const before = snapshot(s)
      expect(() => withdrawTemplateBid(s.db, s.starsi, s.id, T2, on)).toThrow(/audit down/)
      expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 12, null]])
      expect(snapshot(s)).toEqual(before)
    })

    it('the turn-down', () => {
      const s = setup()
      must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
      failAuditOn(s.db, 'template.bids_turned_down')
      const before = snapshot(s)
      const seen = [{ takerId: s.starsi, score: 12 }]
      expect(() => turnDownTemplateBids(s.db, s.tata, s.id, seen, T2, on)).toThrow(/audit down/)
      expect(snapshot(s)).toEqual(before)
    })

    it('the counter', () => {
      const s = setup()
      failAuditOn(s.db, 'template.score_countered')
      const before = snapshot(s)
      expect(() => counterOnTemplate(s.db, s.tata, s.id, 12, T1, on)).toThrow(/audit down/)
      expect(snapshot(s)).toEqual(before)
    })

    it('the agreement, by each path', () => {
      const s = setup()
      must(counterOnTemplate(s.db, s.tata, s.id, 11, T1, on))
      must(bidOnTemplate(s.db, s.starsi, s.id, 12, T1, on))
      failAuditOn(s.db, 'template.agreed')
      const before = snapshot(s)
      expect(() => acceptLowestBidOnTemplate(s.db, s.tata, s.id, 12, T2, on)).toThrow(/audit down/)
      expect(() => acceptOfferOnTemplate(s.db, s.starsi, s.id, 11, T2, on)).toThrow(/audit down/)
      expect(() => counterOnTemplate(s.db, s.mama, s.id, 12, T2, on)).toThrow(/audit down/)
      expect(() => approveTemplateScore(s.db, s.mladsi, s.id, 11, T2)).toThrow(/audit down/)
      expect(snapshot(s)).toEqual(before)
    })
  })
})
