import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { byPerson, cancelItem } from '~/domain'
import type { Db } from '~/server/db'
import { auditLog, taskScoreApprovals } from '~/server/db/schema'
import { updateUser } from '~/server/users/manage'
import { acceptLowestTaskBid, acceptOffer, counterOffer, placeBid } from './bidding'
import { saveItem, toItem } from './item'
import { completeTask, releaseTask, reserveTask } from './lifecycle'
import {
  approveTaskOffer,
  getTaskDetail,
  listBidsToAnswer,
  listTasks,
  pendingApprovals,
} from './tasks'
import {
  addGiver,
  addTaker,
  audits,
  car,
  failAuditOn,
  family,
  json,
  lastAudit,
  must,
  offerInStep,
  row,
  T0,
  T1,
  T2,
  T3,
  thread,
} from './testing'

/** `[userId, score]` of the task's approvals in one offer round, by time, then user. */
const approvals = (db: Db, taskId: number, round: number) =>
  db
    .select()
    .from(taskScoreApprovals)
    .where(and(eq(taskScoreApprovals.taskId, taskId), eq(taskScoreApprovals.offerRound, round)))
    .orderBy(asc(taskScoreApprovals.approvedAt), asc(taskScoreApprovals.userId))
    .all()
    .map((a) => [a.userId, a.score])

describe('placeBid (spec §5.2 path 2)', () => {
  it('a taker bids a different score; the task stays proposed', () => {
    const f = family()
    const id = car(f)
    expect(must(placeBid(f.db, f.starsi, id, 25, T1))).toMatchObject({
      status: 'proposed',
      score: 18,
      offerRound: 1,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, null],
      ['taker', f.starsi, 25, null],
    ])
    expect(lastAudit(f.db)).toMatchObject({
      action: 'task.bid_placed',
      actorUserId: f.starsi,
      entityType: 'task',
      entityId: String(id),
      before: null,
    })
    expect(json(lastAudit(f.db)?.after)).toEqual({ entryId: 2, score: 25 })
  })
  it('bidding again replaces his own bid and keeps the old one (25 → 23); his brother bids too', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(placeBid(f.db, f.starsi, id, 23, T2))
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, null],
      ['taker', f.starsi, 25, 'replaced'],
      ['taker', f.mladsi, 22, null],
      ['taker', f.starsi, 23, null],
    ])
    expect(json(lastAudit(f.db)?.before)).toEqual({ entryId: 2, score: 25 })
    expect(json(lastAudit(f.db)?.after)).toEqual({ entryId: 4, score: 23 })
  })
  it('1 is a bid, 0 is not; the offer and his own number again are refused', () => {
    const f = family()
    const id = car(f)
    expect(placeBid(f.db, f.starsi, id, 0, T1)).toEqual({ ok: false, error: 'invalid_score' })
    expect(placeBid(f.db, f.starsi, id, 18, T1)).toEqual({ ok: false, error: 'same_score' })
    must(placeBid(f.db, f.starsi, id, 1, T1))
    expect(placeBid(f.db, f.starsi, id, 1, T2)).toEqual({ ok: false, error: 'same_score' }) // double tap
    expect(thread(f.db, id)).toHaveLength(2)
    expect(audits(f.db, id)).toEqual(['task.created', 'task.bid_placed'])
  })
  it.each(['tata', 'admin'] as const)('%s cannot bid', (who) => {
    const f = family()
    const id = car(f)
    expect(placeBid(f.db, f[who], id, 25, T1)).toEqual({ ok: false, error: 'not_a_taker' })
    expect(thread(f.db, id)).toHaveLength(1)
  })
  it('an unknown task is not found', () => {
    const f = family()
    expect(placeBid(f.db, f.starsi, 999, 25, T1)).toEqual({ ok: false, error: 'not_found' })
  })
  it('a failed audit write rolls the re-bid back: the old bid is still the open one', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    failAuditOn(f.db, 'task.bid_placed')
    expect(() => placeBid(f.db, f.starsi, id, 23, T2)).toThrow(/audit down/)
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, null],
      ['taker', f.starsi, 25, null],
    ])
  })
})

describe('counterOffer (Jakub 2026-11-17: one new offer to every taker)', () => {
  it('a new offer round with only his approval; bids stay open', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(must(counterOffer(f.db, f.tata, id, 20, [], T2))).toMatchObject({
      status: 'proposed',
      score: 20,
      offerRound: 2,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'replaced'],
      ['taker', f.starsi, 25, null],
      ['giver', f.tata, 20, null],
    ])
    expect(approvals(f.db, id, 2)).toEqual([[f.tata, 20]]) // [userId, score] of that offer round
    expect(lastAudit(f.db)).toMatchObject({ action: 'task.score_countered', actorUserId: f.tata })
    expect(json(lastAudit(f.db)?.before)).toEqual({ score: 18, offerRound: 1, entryId: 1 })
    expect(json(lastAudit(f.db)?.after)).toEqual({ score: 20, offerRound: 2, entryId: 3 })
    expect(offerInStep(f.db, id)).toBe(true)
    // Path 1 on the new offer: a taker's approval of 18 is refused, of 20 opens it.
    expect(approveTaskOffer(f.db, f.mladsi, id, 18, T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(must(approveTaskOffer(f.db, f.mladsi, id, 20, T3))).toMatchObject({
      status: 'open',
      score: 20,
    })
  })
  it('[call] another giver may counter and is then the agreeing giver', () => {
    const f = family()
    const id = car(f)
    const mama = addGiver(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(counterOffer(f.db, mama, id, 20, [], T2))
    expect(must(acceptOffer(f.db, f.starsi, id, 20, T3))).toMatchObject({
      reservedBy: f.starsi,
      reservedGiverId: mama,
    })
  })
  it('refuses the same number, 0, a taker and the admin; nothing is written', () => {
    const f = family()
    const id = car(f)
    expect(counterOffer(f.db, f.tata, id, 18, [], T1)).toEqual({ ok: false, error: 'same_score' })
    expect(counterOffer(f.db, f.tata, id, 0, [], T1)).toEqual({ ok: false, error: 'invalid_score' })
    expect(counterOffer(f.db, f.starsi, id, 20, [], T1)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(counterOffer(f.db, f.admin, id, 20, [], T1)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(row(f.db, id)).toMatchObject({ score: 18, offerRound: 1 })
    expect(audits(f.db, id)).toEqual(['task.created'])
  })
  it('with nobody bidding it is a plain new offer; approvals of the old number no longer count (decision 8a)', () => {
    const f = family()
    const id = car(f)
    expect(must(counterOffer(f.db, f.tata, id, 15, [], T1))).toMatchObject({
      status: 'proposed',
      score: 15,
      offerRound: 2,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'replaced'],
      ['giver', f.tata, 15, null],
    ])
    expect(approvals(f.db, id, 2)).toEqual([[f.tata, 15]])
    expect(offerInStep(f.db, id)).toBe(true)
    expect(approveTaskOffer(f.db, f.starsi, id, 18, T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
  })
  it("at a bid's own number it agrees that bid: reserved to him, the countering giver, thread closed (decision 8b)", () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    expect(must(counterOffer(f.db, f.tata, id, 25, [f.starsi], T2))).toMatchObject({
      status: 'reserved',
      score: 25,
      offerRound: 2,
      reservedBy: f.starsi,
      reservedVia: 'bid',
      reservedGiverId: f.tata,
    })
    // The counter is in the thread too (spec §5.2: every bid and counter), accepted with the bid.
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'replaced'],
      ['taker', f.starsi, 25, 'accepted'],
      ['taker', f.mladsi, 22, 'closed'],
      ['giver', f.tata, 25, 'accepted'],
    ])
    expect(approvals(f.db, id, 2)).toEqual([])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.bid_accepted', 'task.agreed'])
    const [accepted, agreed] = f.db.select().from(auditLog).all().slice(-2)
    expect(json(accepted?.after)).toEqual({
      score: 25,
      entryIds: [2],
      by: 'counter',
      offerEntryId: 4,
    })
    expect(json(accepted?.before)).toEqual({ entryId: 1, score: 18 }) // the offer it replaced
    expect(json(agreed?.after)).toMatchObject({ status: 'reserved', accepted: [2, 4], closed: [3] })
  })
  it('[call] another giver countering at a bid is the agreeing giver (decision 8b)', () => {
    const f = family()
    const id = car(f)
    const mama = addGiver(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(must(counterOffer(f.db, mama, id, 25, [f.starsi], T2))).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
      reservedGiverId: mama,
    })
  })
  it('at a number both brothers bid it opens the task at that number (decision 8b)', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 22, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    expect(must(counterOffer(f.db, f.tata, id, 22, [f.starsi, f.mladsi], T2))).toMatchObject({
      status: 'open',
      score: 22,
      reservedBy: null,
    })
    expect(thread(f.db, id).map((e) => e[3])).toEqual([
      'replaced',
      'accepted',
      'accepted',
      'accepted',
    ])
  })
  it('a counter is refused when the bids at that number changed under the giver (offer_changed)', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(counterOffer(f.db, f.tata, id, 25, [], T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    must(placeBid(f.db, f.mladsi, id, 25, T2))
    expect(counterOffer(f.db, f.tata, id, 25, [f.starsi], T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(row(f.db, id)).toMatchObject({ status: 'proposed', score: 18, offerRound: 1 })
    expect(audits(f.db, id)).toEqual(['task.created', 'task.bid_placed', 'task.bid_placed'])
  })
  it('a failed audit write rolls the counter-at-a-bid back', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    failAuditOn(f.db, 'task.agreed')
    expect(() => counterOffer(f.db, f.tata, id, 25, [f.starsi], T2)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({
      status: 'proposed',
      score: 18,
      offerRound: 1,
      reservedBy: null,
    })
    expect(thread(f.db, id).map((e) => e[3])).toEqual([null, null])
  })
  it('a failed audit write rolls the counter back', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    failAuditOn(f.db, 'task.score_countered')
    expect(() => counterOffer(f.db, f.tata, id, 20, [], T2)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ score: 18, offerRound: 1 })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, null],
      ['taker', f.starsi, 25, null],
    ])
    expect(approvals(f.db, id, 2)).toEqual([])
  })
})

describe('acceptOffer (a taker with a bid accepts the offer: agreed and reserved in one step)', () => {
  const bidding = () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(counterOffer(f.db, f.tata, id, 20, [], T2))
    return { f, id }
  }
  it('reserved to him at the offer with the offering giver; the whole thread closes', () => {
    const { f, id } = bidding()
    expect(must(acceptOffer(f.db, f.starsi, id, 20, T3))).toMatchObject({
      status: 'reserved',
      score: 20,
      offerRound: 2,
      agreedAt: T3.toISOString(),
      reservedBy: f.starsi,
      reservedVia: 'bid',
      reservedGiverId: f.tata,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'replaced'],
      ['taker', f.starsi, 25, 'closed'],
      ['taker', f.mladsi, 22, 'closed'],
      ['giver', f.tata, 20, 'accepted'],
    ])
    expect(approvals(f.db, id, 2)).toEqual([
      [f.tata, 20],
      [f.starsi, 20],
    ])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.score_approved', 'task.agreed'])
    expect(json(lastAudit(f.db)?.after)).toEqual({
      status: 'reserved',
      score: 20,
      offerRound: 2,
      reservedBy: f.starsi,
      reservedVia: 'bid',
      reservedGiverId: f.tata,
      accepted: [4],
      closed: [2, 3],
    })
  })
  it('the number he saw: accepting 18 after the counter to 20 is refused', () => {
    const { f, id } = bidding()
    expect(acceptOffer(f.db, f.starsi, id, 18, T3)).toEqual({ ok: false, error: 'offer_changed' })
    expect(row(f.db, id)?.status).toBe('proposed')
  })
  it('needs his own open bid; a giver and the admin cannot; with a bid he may take the first offer', () => {
    const f = family()
    const id = car(f)
    expect(acceptOffer(f.db, f.starsi, id, 18, T1)).toEqual({ ok: false, error: 'no_bid' })
    expect(acceptOffer(f.db, f.tata, id, 18, T1)).toEqual({ ok: false, error: 'not_a_taker' })
    expect(acceptOffer(f.db, f.admin, id, 18, T1)).toEqual({ ok: false, error: 'not_a_taker' })
    expect(audits(f.db, id)).toEqual(['task.created'])
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(must(acceptOffer(f.db, f.starsi, id, 18, T2))).toMatchObject({
      status: 'reserved',
      score: 18,
      offerRound: 1,
      reservedBy: f.starsi,
      reservedGiverId: f.tata,
    })
  })
  it('a failed audit write rolls the agreement back', () => {
    const { f, id } = bidding()
    failAuditOn(f.db, 'task.agreed')
    expect(() => acceptOffer(f.db, f.starsi, id, 20, T3)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'proposed', reservedBy: null, agreedAt: null })
    expect(thread(f.db, id).map((e) => e[3])).toEqual(['replaced', null, null, null])
    expect(approvals(f.db, id, 2)).toEqual([[f.tata, 20]])
  })
})

describe('acceptLowestTaskBid (the giver side accepts the lowest open bid)', () => {
  it('one lowest bidder: reserved to him at his bid, in a new offer round with no approvals', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    expect(must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T2))).toMatchObject({
      status: 'reserved',
      score: 22,
      offerRound: 2,
      agreedAt: T2.toISOString(),
      reservedBy: f.mladsi,
      reservedVia: 'bid',
      reservedGiverId: f.tata,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'closed'],
      ['taker', f.starsi, 25, 'closed'],
      ['taker', f.mladsi, 22, 'accepted'],
    ])
    expect(approvals(f.db, id, 2)).toEqual([]) // pending approvals are discarded
    expect(audits(f.db, id).slice(-2)).toEqual(['task.bid_accepted', 'task.agreed'])
    const [accepted, agreed] = f.db.select().from(auditLog).all().slice(-2)
    expect(accepted).toMatchObject({ actorUserId: f.tata })
    expect(json(accepted?.after)).toEqual({ score: 22, entryIds: [3] })
    expect(json(agreed?.before)).toEqual({ status: 'proposed', score: 18, offerRound: 1 })
    expect(json(agreed?.after)).toMatchObject({
      status: 'reserved',
      score: 22,
      offerRound: 2,
      accepted: [3],
      closed: [1, 2],
    })
  })
  it('a tie at the lowest: open at that score, the tied bids accepted, a higher one closed, either may reserve', () => {
    const f = family()
    const id = car(f)
    const bratranec = addTaker(f)
    must(placeBid(f.db, f.starsi, id, 22, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(placeBid(f.db, bratranec, id, 25, T1))
    expect(must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi, f.starsi], T2))).toMatchObject(
      { status: 'open', score: 22, reservedBy: null },
    )
    expect(thread(f.db, id).map((e) => e[3])).toEqual(['closed', 'accepted', 'accepted', 'closed'])
    expect(must(reserveTask(f.db, f.mladsi, id, T3))).toMatchObject({
      status: 'reserved',
      reservedVia: 'tap',
    })
  })
  it('[call] another giver may accept and is then the agreeing giver', () => {
    const f = family()
    const id = car(f)
    const mama = addGiver(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(must(acceptLowestTaskBid(f.db, mama, id, 25, [f.starsi], T2))).toMatchObject({
      reservedBy: f.starsi,
      reservedGiverId: mama,
    })
  })
  it('the number the giver saw: accepting 25 after the re-bid to 23 is refused', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.starsi, id, 23, T2))
    expect(acceptLowestTaskBid(f.db, f.tata, id, 25, [f.starsi], T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(row(f.db, id)).toMatchObject({ status: 'proposed', score: 18 })
  })
  it('the bidder the giver saw: "Přijmout 22 (Mladší)" is refused once his brother holds or shares the 22', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.starsi, id, 22, T2)) // now a tie at 22
    const before = f.db.select().from(auditLog).all().length
    expect(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    must(placeBid(f.db, f.mladsi, id, 24, T2)) // now Starší alone holds 22
    expect(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(row(f.db, id)).toMatchObject({ status: 'proposed', score: 18, reservedBy: null })
    expect(f.db.select().from(auditLog).all()).toHaveLength(before + 1) // only Mladší's re-bid
    expect(must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.starsi], T3))).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
    })
  })
  it('a repeated bidder is refused and writes nothing; the tied bids are both accepted when named (code round 1)', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 15, T1))
    must(placeBid(f.db, f.mladsi, id, 15, T1))
    expect(acceptLowestTaskBid(f.db, f.tata, id, 15, [f.starsi, f.starsi], T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(counterOffer(f.db, f.tata, id, 15, [f.mladsi, f.mladsi], T2)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(audits(f.db, id)).toEqual(['task.created', 'task.bid_placed', 'task.bid_placed'])
    must(acceptLowestTaskBid(f.db, f.tata, id, 15, [f.mladsi, f.starsi], T2))
    expect(thread(f.db, id).map((e) => e[3])).toEqual(['closed', 'accepted', 'accepted'])
  })
  it('needs a bid; a taker and the admin cannot', () => {
    const f = family()
    const id = car(f)
    expect(acceptLowestTaskBid(f.db, f.tata, id, 18, [f.starsi], T1)).toEqual({
      ok: false,
      error: 'no_bids',
    })
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(acceptLowestTaskBid(f.db, f.mladsi, id, 25, [f.starsi], T2)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(acceptLowestTaskBid(f.db, f.admin, id, 25, [f.starsi], T2)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
  })
  it('a failed audit write rolls the acceptance back', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    failAuditOn(f.db, 'task.bid_accepted')
    expect(() => acceptLowestTaskBid(f.db, f.tata, id, 25, [f.starsi], T2)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'proposed', score: 18, offerRound: 1 })
    expect(thread(f.db, id).map((e) => e[3])).toEqual([null, null])
  })
})

describe("a bidder's yes picks (Jakub 2026-11-18, spec PR #133)", () => {
  it("'Souhlasím' from a bidder opens the task for everyone at the offer; his bid closes", () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(counterOffer(f.db, f.tata, id, 20, [], T2))
    expect(must(approveTaskOffer(f.db, f.starsi, id, 20, T3))).toMatchObject({
      status: 'open',
      score: 20,
      reservedBy: null,
      reservedVia: null,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'replaced'],
      ['taker', f.starsi, 25, 'closed'],
      ['giver', f.tata, 20, 'accepted'],
    ])
    expect(must(reserveTask(f.db, f.mladsi, id, T3))).toMatchObject({
      status: 'reserved',
      reservedBy: f.mladsi,
      reservedVia: 'tap',
    })
  })
  it("'Beru za 20' from the same bidder reserves it to him (the other button)", () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(counterOffer(f.db, f.tata, id, 20, [], T2))
    expect(must(acceptOffer(f.db, f.starsi, id, 20, T3))).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
      reservedVia: 'bid',
    })
  })
})

describe('first agreement wins (spec §5.2; issue "Done when")', () => {
  it('two takers bid, the giver accepts the lowest: every later action is refused and writes nothing', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T2))
    const before = f.db.select().from(auditLog).all().length
    const gone = { ok: false, error: 'not_proposed' }
    expect(acceptOffer(f.db, f.starsi, id, 18, T3)).toEqual(gone)
    expect(placeBid(f.db, f.starsi, id, 21, T3)).toEqual(gone)
    expect(approveTaskOffer(f.db, f.starsi, id, 22, T3)).toEqual(gone)
    expect(counterOffer(f.db, f.tata, id, 30, [], T3)).toEqual(gone)
    expect(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T3)).toEqual(gone)
    expect(completeTask(f.db, f.starsi, id, T3)).toEqual({ ok: false, error: 'reserved_by_other' })
    expect(f.db.select().from(auditLog).all()).toHaveLength(before)
    expect(thread(f.db, id)).toHaveLength(3)
  })
  it('path 1 first: his brother approves the offer, the task opens and the bid closes', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(must(approveTaskOffer(f.db, f.mladsi, id, 18, T2))).toMatchObject({
      status: 'open',
      score: 18,
      offerRound: 1,
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'accepted'],
      ['taker', f.starsi, 25, 'closed'],
    ])
    expect(json(lastAudit(f.db)?.after)).toMatchObject({ accepted: [1], closed: [2] })
    expect(acceptLowestTaskBid(f.db, f.tata, id, 25, [f.starsi], T3)).toEqual({
      ok: false,
      error: 'not_proposed',
    })
  })
  it('a people change that opens the task closes its bids (real hook, updateUser)', () => {
    const f = family()
    const id = car(f)
    const byAdmin = { kind: 'user', userId: f.admin } as const
    must(updateUser(f.db, byAdmin, f.tata, { active: false }, T0))
    must(approveTaskOffer(f.db, f.starsi, id, 18, T1))
    must(placeBid(f.db, f.mladsi, id, 25, T1))
    must(updateUser(f.db, byAdmin, f.tata, { active: true }, T2))
    expect(row(f.db, id)).toMatchObject({ status: 'open', score: 18 })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'accepted'],
      ['taker', f.mladsi, 25, 'closed'],
    ])
  })
  it('any step that takes a task out of proposed closes its thread (what a cancel will do, #36)', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    const task = row(f.db, id)
    if (!task) throw new Error('no task')
    const cancelled = must(
      cancelItem(toItem(task), byPerson({ id: f.tata, role: 'giver', active: true })),
    )
    const saved = f.db.transaction((tx) => saveItem(tx, task, cancelled, {}, T2))
    expect(saved.row.status).toBe('cancelled')
    expect([saved.accepted, saved.closed]).toEqual([[], [1, 2]])
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, 'closed'],
      ['taker', f.starsi, 25, 'closed'],
    ])
  })
  it('a bid-won task that is released is negotiated again: old bids do not count (spec §5.4 [call])', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T2))
    expect(must(releaseTask(f.db, f.mladsi, id, T3))).toMatchObject({
      status: 'proposed',
      score: 22,
      offerRound: 3,
    })
    expect(thread(f.db, id).at(-1)).toEqual(['giver', f.tata, 22, null])
    expect(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T3)).toEqual({
      ok: false,
      error: 'no_bids',
    })
    must(placeBid(f.db, f.starsi, id, 20, T3))
    expect(must(acceptLowestTaskBid(f.db, f.tata, id, 20, [f.starsi], T3))).toMatchObject({
      status: 'reserved',
      score: 20,
      reservedBy: f.starsi,
    })
  })
})

describe('what screens get (PR B)', () => {
  it('waitingFor: the brothers while nobody said yes (a bid is no yes), [] once agreed', () => {
    const f = family()
    const id = car(f)
    const both = [
      { id: f.starsi, name: 'Starší' },
      { id: f.mladsi, name: 'Mladší' },
    ]
    const view = () => listTasks(f.db).find((t) => t.id === id)
    expect(view()?.waitingFor).toEqual(both)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    expect(view()?.waitingFor).toEqual(both)
    must(approveTaskOffer(f.db, f.starsi, id, 18, T2))
    expect(view()).toMatchObject({ status: 'open', waitingFor: [] })
    const other = car(f)
    must(placeBid(f.db, f.mladsi, other, 22, T1))
    must(acceptOffer(f.db, f.mladsi, other, 18, T2))
    expect(listTasks(f.db).find((t) => t.id === other)).toMatchObject({
      status: 'reserved',
      waitingFor: [],
    })
  })
  it('a proposed task carries its offering giver and open bids, lowest first', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    expect(pendingApprovals(f.db, f.starsi)[0]).toMatchObject({
      id,
      score: 18,
      offeredByName: 'Táta',
      bids: [
        { takerId: f.mladsi, name: 'Mladší', score: 22 },
        { takerId: f.starsi, name: 'Starší', score: 25 },
      ],
      lowest: { score: 22, bidders: [{ id: f.mladsi, name: 'Mladší' }] },
    })
    must(placeBid(f.db, f.starsi, id, 22, T2))
    expect(pendingApprovals(f.db, f.mladsi)[0]?.lowest).toEqual({
      score: 22,
      bidders: [
        { id: f.starsi, name: 'Starší' },
        { id: f.mladsi, name: 'Mladší' },
      ],
    })
  })
  it("after another giver's counter the view names her as the one offering", () => {
    const f = family()
    const id = car(f)
    const mama = addGiver(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(counterOffer(f.db, mama, id, 20, [], T1))
    expect(pendingApprovals(f.db, f.starsi)[0]).toMatchObject({
      score: 20,
      createdByName: 'Táta',
      offeredByName: 'Máma',
    })
  })
  it('getTaskDetail returns exactly the view and the thread', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.starsi, id, 23, T2))
    expect(getTaskDetail(f.db, id)).toEqual({
      task: {
        id,
        title: 'Umýt auto',
        status: 'proposed',
        score: 18,
        approvalRequired: true,
        createdByName: 'Táta',
        offeredByName: 'Táta',
        approvedBy: ['Táta'],
        approverIds: [f.tata],
        bids: [{ takerId: f.starsi, name: 'Starší', score: 23 }],
        lowest: { score: 23, bidders: [{ id: f.starsi, name: 'Starší' }] },
        reservedBy: null,
        completedBy: null,
        completedAt: null,
        earnerId: null,
        origin: 'one_time',
        templateId: null,
        dueAt: null,
        graceEndsAt: null,
        waitingFor: [
          { id: f.starsi, name: 'Starší' },
          { id: f.mladsi, name: 'Mladší' },
        ],
        scoreChange: null,
      },
      thread: [
        {
          id: 1,
          side: 'giver',
          by: { id: f.tata, name: 'Táta' },
          score: 18,
          at: T0.toISOString(),
          state: 'open',
        },
        {
          id: 2,
          side: 'taker',
          by: { id: f.starsi, name: 'Starší' },
          score: 25,
          at: T1.toISOString(),
          state: 'replaced',
        },
        {
          id: 3,
          side: 'taker',
          by: { id: f.starsi, name: 'Starší' },
          score: 23,
          at: T2.toISOString(),
          state: 'open',
        },
      ],
      history: expect.any(Array) as unknown,
    })
    expect(getTaskDetail(f.db, 999)).toBeNull()
  })
  it("the taker who lost sees the task as his brother's (issue 'Done when')", () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(placeBid(f.db, f.mladsi, id, 22, T1))
    must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T2))
    const detail = getTaskDetail(f.db, id)
    expect(detail?.task).toMatchObject({
      status: 'reserved',
      score: 22,
      reservedBy: { id: f.mladsi, name: 'Mladší' },
      bids: [],
      lowest: null,
      offeredByName: null,
    })
    expect(detail?.thread.map((e) => [e.by.name, e.score, e.state])).toEqual([
      ['Táta', 18, 'closed'],
      ['Starší', 25, 'closed'],
      ['Mladší', 22, 'accepted'],
    ])
    expect(pendingApprovals(f.db, f.starsi)).toEqual([])
  })
  it('listBidsToAnswer: proposed tasks with an open bid, oldest first; gone once agreed', () => {
    const f = family()
    const a = car(f)
    const b = car(f)
    car(f)
    must(placeBid(f.db, f.starsi, b, 25, T1))
    must(placeBid(f.db, f.mladsi, a, 22, T2))
    expect(listBidsToAnswer(f.db).map((t) => t.id)).toEqual([a, b])
    must(acceptLowestTaskBid(f.db, f.tata, a, 22, [f.mladsi], T3))
    expect(listBidsToAnswer(f.db).map((t) => t.id)).toEqual([b])
  })
})
