import { describe, expect, it } from 'vitest'
import { tasks } from '~/server/db/schema'
import { agreedTemplate } from '~/server/templates/testing'
import {
  acceptLowestTaskBid,
  acceptOffer,
  counterOffer,
  placeBid,
  reopenBidding,
  turnDownBids,
  withdrawBid,
} from './bidding'
import { taskHistory } from './history'
import { cancelTask, completeTask, reserveTask } from './lifecycle'
import { proposeTaskScoreChange } from './scoreChange'
import { approveTaskOffer } from './tasks'
import type { Family } from './testing'
import {
  audits,
  car,
  failAuditOn,
  family,
  json,
  lastAudit,
  must,
  row,
  T0,
  T1,
  T2,
  T3,
  thread,
} from './testing'

// Reopening bidding on an open one-time task (#212, spec §5.2 "Reopening bidding").

/** Umýt auto agreed at 18 by Starší's yes: open, its Návrh thread closed (one row, id 1). */
function openCar(f: Family): number {
  const id = car(f)
  must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
  return id
}

/** An open car with a round reopened by Starší. */
function round(f: Family): number {
  const id = openCar(f)
  must(reopenBidding(f.db, f.starsi, id, T1))
  return id
}

const roundRows = (f: Family, id: number) => thread(f.db, id).slice(1)

describe('reopenBidding (#212)', () => {
  it('starts a round: open, same score, marker at the newest row, logged', () => {
    const f = family()
    const id = openCar(f)
    const saved = must(reopenBidding(f.db, f.starsi, id, T1))
    expect(saved).toMatchObject({ status: 'open', score: 18, biddingFrom: 1, offerRound: 1 })
    expect(lastAudit(f.db)).toMatchObject({
      action: 'task.bidding_reopened',
      actorUserId: f.starsi,
    })
    expect(json(lastAudit(f.db)?.after)).toEqual({ score: 18, biddingFrom: 1 })
    must(reopenBidding(f.db, f.tata, openCar(f), T1))
  })

  it('a bid from the Návrh does not block the same number in the round', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.mladsi, id, 5, T0))
    must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
    must(reopenBidding(f.db, f.starsi, id, T1))
    must(placeBid(f.db, f.mladsi, id, 5, T2))
    expect(roundRows(f, id).at(-1)).toEqual(['taker', f.mladsi, 5, null])
  })

  it('same number within the round: bid, Nechci, same bid refused; after a counter allowed', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    must(withdrawBid(f.db, f.starsi, id, T2))
    expect(placeBid(f.db, f.starsi, id, 12, T2)).toEqual({ ok: false, error: 'same_score' })
    expect(placeBid(f.db, f.starsi, id, 18, T2)).toEqual({ ok: false, error: 'same_score' })
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    must(placeBid(f.db, f.starsi, id, 12, T3))
  })

  it.each([
    ['reserved', { status: 'reserved', reservedBy: 2, reservedVia: 'tap' }],
    ['done', { status: 'done_unconfirmed', completedBy: 2, completedAt: T0.toISOString() }],
    ['confirmed', { status: 'confirmed', completedBy: 2, completedAt: T0.toISOString() }],
    ['cancelled', { status: 'cancelled' }],
  ] as const)('a %s task is not_changeable', (_, set) => {
    const f = family()
    const id = openCar(f)
    f.db.update(tasks).set(set).run()
    expect(reopenBidding(f.db, f.starsi, id, T1)).toEqual({ ok: false, error: 'not_changeable' })
    expect(row(f.db, id)?.biddingFrom).toBeNull()
  })

  it('refusals: Návrh, a running round, an open score change, admin, an instance', () => {
    const f = family()
    expect(reopenBidding(f.db, f.starsi, car(f), T1)).toEqual({
      ok: false,
      error: 'not_changeable',
    })
    expect(reopenBidding(f.db, f.starsi, round(f), T2)).toEqual({
      ok: false,
      error: 'bidding_open',
    })
    const changing = openCar(f)
    must(proposeTaskScoreChange(f.db, f.starsi, changing, 20, T1))
    expect(reopenBidding(f.db, f.tata, changing, T2)).toEqual({
      ok: false,
      error: 'change_pending',
    })
    expect(reopenBidding(f.db, f.admin, openCar(f), T1)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
    const instance = f.db
      .insert(tasks)
      .values({
        title: 'Vyndat myčku',
        status: 'open',
        score: 3,
        approvalRequired: true,
        createdBy: f.tata,
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
        agreedAt: T0.toISOString(),
        templateId: agreedTemplate(f),
        origin: 'on_demand',
      })
      .returning()
      .get().id
    expect(reopenBidding(f.db, f.starsi, instance, T1)).toEqual({
      ok: false,
      error: 'not_changeable',
    })
    expect(row(f.db, instance)?.biddingFrom).toBeNull()
  })

  it('a score change is refused while a round runs', () => {
    const f = family()
    const id = round(f)
    expect(proposeTaskScoreChange(f.db, f.starsi, id, 20, T2)).toEqual({
      ok: false,
      error: 'bidding_open',
    })
  })

  it('with rebid on, Jiná cena on an open one-time task is refused in the transaction', () => {
    const f = family()
    const id = openCar(f)
    expect(proposeTaskScoreChange(f.db, f.starsi, id, 20, T1, { rebid: true })).toEqual({
      ok: false,
      error: 'bidding_instead',
    })
    expect(audits(f.db, id)).not.toContain('task.score_change_proposed')
    must(reserveTask(f.db, f.starsi, id, T1))
    expect(proposeTaskScoreChange(f.db, f.starsi, id, 20, T2, { rebid: true }).ok).toBe(true)
  })

  it('a save that keeps the task open leaves the round running', () => {
    const f = family()
    const id = round(f)
    const from = row(f.db, id)?.biddingFrom
    must(placeBid(f.db, f.mladsi, id, 15, T2))
    expect(row(f.db, id)?.biddingFrom).toBe(from)
    expect(row(f.db, id)?.status).toBe('open')
  })

  it('a failed audit write leaves no round', () => {
    const f = family()
    const id = openCar(f)
    failAuditOn(f.db, 'task.bidding_reopened')
    expect(() => reopenBidding(f.db, f.starsi, id, T1)).toThrow(/audit down/)
    expect(row(f.db, id)?.biddingFrom).toBeNull()
  })
})

describe('a round ends when the task leaves open (#212 [call])', () => {
  it('reserving at the old score closes the bids, logged after the reservation', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.mladsi, id, 12, T2))
    must(reserveTask(f.db, f.starsi, id, T3))
    expect(row(f.db, id)).toMatchObject({ status: 'reserved', score: 18, biddingFrom: null })
    expect(roundRows(f, id)).toEqual([['taker', f.mladsi, 12, 'closed']])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.reserved', 'task.bidding_closed'])
    expect(json(lastAudit(f.db)?.after)).toEqual({ entryIds: [2] })
  })

  it('completing does the same', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.mladsi, id, 12, T2))
    must(completeTask(f.db, f.starsi, id, T3))
    expect(row(f.db, id)).toMatchObject({ status: 'done_unconfirmed', biddingFrom: null })
    expect(roundRows(f, id)).toEqual([['taker', f.mladsi, 12, 'closed']])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.completed', 'task.bidding_closed'])
    expect(json(lastAudit(f.db)?.after)).toEqual({ entryIds: [2] })
  })

  it('cancelling does the same', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.mladsi, id, 12, T2))
    must(cancelTask(f.db, f.tata, id, undefined, T3))
    expect(row(f.db, id)).toMatchObject({ status: 'cancelled', biddingFrom: null })
    expect(roundRows(f, id)).toEqual([['taker', f.mladsi, 12, 'closed']])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.cancelled', 'task.bidding_closed'])
    expect(json(lastAudit(f.db)?.after)).toEqual({ entryIds: [2] })
  })

  it('a reservation without a round logs no bidding_closed', () => {
    const f = family()
    const id = openCar(f)
    must(reserveTask(f.db, f.starsi, id, T3))
    expect(audits(f.db, id).at(-1)).toBe('task.reserved')
  })

  it('a failed bidding_closed write rolls the reservation back', () => {
    const f = family()
    const id = round(f)
    failAuditOn(f.db, 'task.bidding_closed')
    expect(() => reserveTask(f.db, f.starsi, id, T3)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'open', biddingFrom: 1 })
  })
})

describe('a round agrees (#212)', () => {
  it('the single lowest bid: reserved to him at it, a new offer round', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    must(placeBid(f.db, f.mladsi, id, 14, T2))
    must(acceptLowestTaskBid(f.db, f.tata, id, 12, [f.starsi], T3))
    expect(row(f.db, id)).toMatchObject({
      status: 'reserved',
      score: 12,
      offerRound: 2,
      reservedBy: f.starsi,
      reservedVia: 'bid',
      reservedGiverId: f.tata,
      biddingFrom: null,
    })
    expect(roundRows(f, id)).toEqual([
      ['taker', f.starsi, 12, 'accepted'],
      ['taker', f.mladsi, 14, 'closed'],
    ])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.bid_accepted', 'task.agreed'])
  })

  it('a tie at the lowest: open at it', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    must(placeBid(f.db, f.mladsi, id, 12, T2))
    must(acceptLowestTaskBid(f.db, f.tata, id, 12, [f.starsi, f.mladsi], T3))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 12, biddingFrom: null })
  })

  it('a plain counter leaves the task open at the old score, the round running', () => {
    const f = family()
    const id = round(f)
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18, biddingFrom: 1 })
    expect(roundRows(f, id)).toEqual([['giver', f.tata, 15, null]])
    expect(audits(f.db, id).at(-1)).toBe('task.score_countered')
    expect(json(lastAudit(f.db)?.after)).toEqual({ score: 15, entryId: 2 })
  })

  it("a brother's yes to the counter opens the task at it", () => {
    const f = family()
    const id = round(f)
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    must(approveTaskOffer(f.db, f.mladsi, id, 15, T3))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 15, biddingFrom: null })
    expect(roundRows(f, id)).toEqual([['giver', f.tata, 15, 'accepted']])
  })

  it('a bidder accepts the counter: reserved to him with that giver', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    must(acceptOffer(f.db, f.starsi, id, 15, T3))
    expect(row(f.db, id)).toMatchObject({
      status: 'reserved',
      score: 15,
      reservedBy: f.starsi,
      reservedGiverId: f.tata,
      biddingFrom: null,
    })
  })

  it('a stale yes is offer_changed: nothing written, the round runs on', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    must(counterOffer(f.db, f.tata, id, 20, [], T2))
    const before = audits(f.db, id).length
    expect(approveTaskOffer(f.db, f.mladsi, id, 15, T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(acceptOffer(f.db, f.starsi, id, 15, T3)).toEqual({ ok: false, error: 'offer_changed' })
    expect(audits(f.db, id)).toHaveLength(before)
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18, biddingFrom: 1 })
  })

  it('a yes to the opening offer is no_offer', () => {
    const f = family()
    const id = round(f)
    expect(approveTaskOffer(f.db, f.mladsi, id, 18, T2)).toEqual({ ok: false, error: 'no_offer' })
  })

  it('agreeing at the old score keeps the offer round', () => {
    const f = family()
    const id = round(f)
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    must(counterOffer(f.db, f.tata, id, 18, [], T2))
    must(approveTaskOffer(f.db, f.mladsi, id, 18, T3))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18, offerRound: 1 })
  })

  it('a failed counter audit leaves no counter row', () => {
    const f = family()
    const id = round(f)
    failAuditOn(f.db, 'task.score_countered')
    expect(() => counterOffer(f.db, f.tata, id, 15, [], T2)).toThrow(/audit down/)
    expect(roundRows(f, id)).toEqual([])
  })

  it('a failed agreement audit leaves the round as it was', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    failAuditOn(f.db, 'task.agreed')
    expect(() => acceptLowestTaskBid(f.db, f.tata, id, 12, [f.starsi], T3)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18, biddingFrom: 1 })
    expect(roundRows(f, id)).toEqual([['taker', f.starsi, 12, null]])
  })
})

describe('a giver turns a round down (#212)', () => {
  it('with bids: they close, the task stays open at the old score, round over', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    must(counterOffer(f.db, f.tata, id, 15, [], T2))
    must(turnDownBids(f.db, f.tata, id, [{ takerId: f.starsi, score: 12 }], T3))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18, biddingFrom: null })
    expect(roundRows(f, id)).toEqual([
      ['taker', f.starsi, 12, 'closed'],
      ['giver', f.tata, 15, 'closed'],
    ])
    expect(lastAudit(f.db)).toMatchObject({ action: 'task.bids_turned_down', actorUserId: f.tata })
    expect(json(lastAudit(f.db)?.before)).toEqual({ score: 15, entryIds: [2], offerEntryId: 3 })
    expect(json(lastAudit(f.db)?.after)).toEqual({ status: 'open', score: 18 })
  })

  it('with no bids it stops the round', () => {
    const f = family()
    const id = round(f)
    must(turnDownBids(f.db, f.tata, id, [], T2))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18, biddingFrom: null })
    // Nothing was turned down: logged as the round's end.
    expect(lastAudit(f.db)).toMatchObject({ action: 'task.bidding_closed', actorUserId: f.tata })
    expect(json(lastAudit(f.db)?.before)).toEqual({ score: 18, entryIds: [], offerEntryId: null })
  })

  it('a stale screen is offer_changed; nothing closes', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    expect(turnDownBids(f.db, f.tata, id, [], T3)).toEqual({ ok: false, error: 'offer_changed' })
    expect(row(f.db, id)?.biddingFrom).toBe(1)
  })

  it('a failed audit write leaves the round running', () => {
    const f = family()
    const id = round(f)
    must(placeBid(f.db, f.starsi, id, 12, T2))
    failAuditOn(f.db, 'task.bids_turned_down')
    expect(() => turnDownBids(f.db, f.tata, id, [{ takerId: f.starsi, score: 12 }], T3)).toThrow(
      /audit down/,
    )
    expect(row(f.db, id)?.biddingFrom).toBe(1)
    expect(roundRows(f, id)).toEqual([['taker', f.starsi, 12, null]])
  })

  it('the history names the reopen and the end', () => {
    const f = family()
    const id = round(f)
    must(turnDownBids(f.db, f.tata, id, [], T2))
    const actions = taskHistory(f.db, id, String).map((e) => e.action)
    expect(actions.slice(-2)).toEqual(['task.bidding_reopened', 'task.bidding_closed'])
  })
})
