import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { auditLog, templates, templateThread } from '~/server/db/schema'
import { failAuditOn, family, must, T0, T1, T2, T3 } from '~/server/tasks/testing'
import {
  acceptLowestBidOnTemplate,
  acceptOfferOnTemplate,
  bidOnTemplate,
  counterOnTemplate,
  turnDownTemplateBids,
  withdrawTemplateBid,
} from './scoreChange'
import { approveTemplateScore, createTemplate, getTemplateDetail } from './templates'
import { score, templateAudits, threadRows } from './testing'

// Nechci and turn-down on an agreed chore's price change, and the same-number rule there (#232,
// spec §5.2): the floor `templates.bids_from` resets on every agreement and turn-down.

const on = { choreBidding: true, bidRefusals: true }
const off = { choreBidding: true, bidRefusals: false }

/** "Umýt koupelnu", agreed at 10 (Táta proposed, Starší approved). */
function chore(f: ReturnType<typeof family>, title = 'Umýt koupelnu') {
  const input = { title, score: 10, approvalRequired: true, schedule: null, deadline: null }
  const id = must(createTemplate(f.db, f.tata, input, T0)).id
  must(approveTemplateScore(f.db, f.starsi, id, 10, T0))
  return id
}

function setup() {
  const f = family()
  return { ...f, id: chore(f) }
}

type S = ReturnType<typeof setup>

const bid = (s: S, who: number, n: number, opts = on, id = s.id) =>
  bidOnTemplate(s.db, who, id, n, T1, opts)
const nechci = (s: S, who: number, opts = on, id = s.id) =>
  withdrawTemplateBid(s.db, who, id, T2, opts)
const turnDown = (s: S, seen: { takerId: number; score: number }[], opts = on, id = s.id) =>
  turnDownTemplateBids(s.db, s.tata, id, seen, T2, opts)

const last = <T>(list: T[]) => list[list.length - 1]
const audit = (s: S, id = s.id) => last(templateAudits(s.db, id))
const bidsFrom = (s: S, id = s.id) =>
  s.db.select().from(templates).where(eq(templates.id, id)).get()?.bidsFrom
const count = (s: S) => ({
  audit: s.db.select().from(auditLog).all().length,
  thread: s.db.select().from(templateThread).all().length,
})

describe('Nechci on a price change (#232)', () => {
  it('closes his bid, writes template.bid_withdrawn, others stay', () => {
    const s = setup()
    must(bid(s, s.starsi, 12))
    must(bid(s, s.mladsi, 11))
    const row = must(nechci(s, s.starsi))
    expect(row.score).toBe(10)
    expect(threadRows(s.db, s.id)).toEqual([
      ['taker', s.starsi, 12, 'closed'],
      ['taker', s.mladsi, 11, null],
    ])
    expect(audit(s)).toMatchObject({
      action: 'template.bid_withdrawn',
      actor: s.starsi,
      before: { score: 12 },
    })
  })

  it('then the same number: same_score; after a counter: ok', () => {
    const s = setup()
    must(bid(s, s.starsi, 12))
    must(nechci(s, s.starsi))
    expect(bid(s, s.starsi, 12)).toEqual({ ok: false, error: 'same_score' })
    must(bid(s, s.starsi, 13))
    must(counterOnTemplate(s.db, s.tata, s.id, 11, T2, on))
    must(bid(s, s.starsi, 12))
  })

  it('with no open bid: no_bid; a giver: not_a_taker', () => {
    const s = setup()
    expect(nechci(s, s.starsi)).toEqual({ ok: false, error: 'no_bid' })
    must(bid(s, s.starsi, 12))
    expect(nechci(s, s.tata)).toEqual({ ok: false, error: 'not_a_taker' })
  })
})

describe('turn-down on a price change (#232)', () => {
  it('with an offer: bids close, the offer is re-issued by this giver, same number ok after', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 8, T1, on))
    must(bid(s, s.starsi, 12))
    const before = bidsFrom(s)
    must(turnDown(s, [{ takerId: s.starsi, score: 12 }]))
    expect(score(s.db, s.id)).toBe(10)
    expect(threadRows(s.db, s.id)).toEqual([
      ['giver', s.tata, 8, 'replaced'],
      ['taker', s.starsi, 12, 'closed'],
      ['giver', s.tata, 8, null],
    ])
    const rows = s.db.select().from(templateThread).all()
    const [offer, taken, reissued] = rows.map((r) => r.id)
    expect(audit(s)).toEqual({
      action: 'template.bids_turned_down',
      actor: s.tata,
      kind: 'user',
      before: {
        score: 10,
        entryIds: [taken],
        replacedOffer: { entryId: offer, score: 8 },
        bidsFrom: before,
      },
      after: { entryId: reissued, bidsFrom: reissued },
    })
    must(bid(s, s.starsi, 12))
  })

  it('with no parent offer: refused, nothing written (Jakub 2026-11-26)', () => {
    const s = setup()
    must(bid(s, s.starsi, 12))
    const before = { ...count(s), bidsFrom: bidsFrom(s) }
    expect(turnDown(s, [{ takerId: s.starsi, score: 12 }])).toEqual({
      ok: false,
      error: 'no_offer',
    })
    expect({ ...count(s), bidsFrom: bidsFrom(s) }).toEqual(before)
    expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 12, null]])
  })

  it('then each brother re-bids his own number', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 8, T1, on))
    must(bid(s, s.starsi, 12))
    must(bid(s, s.mladsi, 13))
    const seen = [
      { takerId: s.starsi, score: 12 },
      { takerId: s.mladsi, score: 13 },
    ]
    must(turnDown(s, seen))
    must(bid(s, s.starsi, 12))
    must(bid(s, s.mladsi, 13))
  })

  it('with a stale list writes nothing', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 8, T1, on))
    must(bid(s, s.starsi, 12))
    must(bid(s, s.mladsi, 11))
    const before = count(s)
    expect(turnDown(s, [{ takerId: s.starsi, score: 12 }])).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(count(s)).toEqual(before)
  })

  it('with no bids: no_bids; a taker: not_a_giver', () => {
    const s = setup()
    expect(turnDown(s, [])).toEqual({ ok: false, error: 'no_bids' })
    must(bid(s, s.starsi, 12))
    const seen = [{ takerId: s.starsi, score: 12 }]
    expect(turnDownTemplateBids(s.db, s.mladsi, s.id, seen, T2, on)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
  })
})

describe('the same-number floor (#232)', () => {
  it('an agreement resets it, rows it closed too', () => {
    const s = setup()
    must(bid(s, s.starsi, 12))
    must(bid(s, s.mladsi, 11))
    must(acceptLowestBidOnTemplate(s.db, s.tata, s.id, 11, T2, on))
    const changed = audit(s)
    expect(changed?.action).toBe('template.score_changed')
    expect(changed?.after).toMatchObject({ bidsFrom: bidsFrom(s) })
    must(bid(s, s.starsi, 12))
    must(nechci(s, s.starsi))

    must(counterOnTemplate(s.db, s.tata, s.id, 14, T3, on))
    must(bid(s, s.starsi, 12))
    must(acceptOfferOnTemplate(s.db, s.mladsi, s.id, 14, T3, on))
    // STARSI's open 12 was closed by the agreement at 14; it no longer blocks 12.
    must(bid(s, s.starsi, 12))
  })

  it('a first-price agreement with no rows left open resets it', () => {
    const f = family()
    const input = { title: 'Umýt koupelnu', score: 10, approvalRequired: true }
    const id = must(
      createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0),
    ).id
    const s = { ...f, id }
    must(bid(s, s.starsi, 12))
    must(nechci(s, s.starsi))
    must(approveTemplateScore(f.db, f.starsi, id, 10, T2))
    const agreed = templateAudits(f.db, id).find((a) => a.action === 'template.agreed')
    expect(agreed?.before).toMatchObject({ bidsFrom: 0 })
    expect(agreed?.after).toMatchObject({ bidsFrom: bidsFrom(s) })
    expect(bidsFrom(s)).toBeGreaterThan(0)
    must(bid(s, s.starsi, 12))
  })

  it('is per chore', () => {
    const s = setup()
    const other = chore(s, 'Vyndat myčku')
    must(bid(s, s.starsi, 12))
    must(nechci(s, s.starsi))
    must(counterOnTemplate(s.db, s.tata, other, 8, T1, on))
    must(bid(s, s.mladsi, 12, on, other))
    must(turnDown(s, [{ takerId: s.mladsi, score: 12 }], on, other))
    expect(bid(s, s.starsi, 12)).toEqual({ ok: false, error: 'same_score' })
  })

  it('the agreed view lists each taker’s last bid since the floor', () => {
    const s = setup()
    must(bid(s, s.starsi, 12))
    must(nechci(s, s.starsi))
    expect(getTemplateDetail(s.db, s.id, s.starsi, on)?.template.lastBids).toEqual([
      { takerId: s.starsi, score: 12 },
    ])
    must(counterOnTemplate(s.db, s.tata, s.id, 8, T2, on))
    must(bid(s, s.mladsi, 11))
    expect(getTemplateDetail(s.db, s.id, s.starsi, on)?.template.lastBids).toEqual([
      { takerId: s.mladsi, score: 11 },
    ])
    must(turnDown(s, [{ takerId: s.mladsi, score: 11 }]))
    expect(getTemplateDetail(s.db, s.id, s.starsi, on)?.template.lastBids).toEqual([])
  })
})

describe('refusals on a price change: rollback, switch (#232)', () => {
  it('Nechci rolls back when the audit write fails', () => {
    const s = setup()
    must(bid(s, s.starsi, 12))
    failAuditOn(s.db, 'template.bid_withdrawn')
    const before = count(s)
    expect(() => nechci(s, s.starsi)).toThrow(/audit down/)
    expect(threadRows(s.db, s.id)).toEqual([['taker', s.starsi, 12, null]])
    expect(count(s)).toEqual(before)
  })

  it('a turn-down rolls back when the audit write fails', () => {
    const s = setup()
    must(counterOnTemplate(s.db, s.tata, s.id, 8, T1, on))
    must(bid(s, s.starsi, 12))
    failAuditOn(s.db, 'template.bids_turned_down')
    const before = { ...count(s), rows: threadRows(s.db, s.id), bidsFrom: bidsFrom(s) }
    expect(() => turnDown(s, [{ takerId: s.starsi, score: 12 }])).toThrow(/audit down/)
    expect({ ...count(s), rows: threadRows(s.db, s.id), bidsFrom: bidsFrom(s) }).toEqual(before)
  })

  it('switch off: both answer not_proposed on an agreed chore', () => {
    const s = setup()
    must(bid(s, s.starsi, 12, off))
    const before = count(s)
    expect(nechci(s, s.starsi, off)).toEqual({ ok: false, error: 'not_proposed' })
    expect(turnDown(s, [{ takerId: s.starsi, score: 12 }], off)).toEqual({
      ok: false,
      error: 'not_proposed',
    })
    expect(count(s)).toEqual(before)
  })
})
