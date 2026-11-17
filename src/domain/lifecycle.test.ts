import { describe, expect, it } from 'vitest'
import type { Actor, Deadline, Item, ItemStatus, LifecycleError } from './lifecycle'
import {
  DEFAULT_APPROVAL_REQUIRED,
  SYSTEM,
  approve,
  byPerson,
  cancel,
  complete,
  confirmedEarner,
  createInstance,
  createOneTimeItem,
  expire,
  markAgreed,
  pendingEarner,
  reject,
  release,
  reserve,
  selfLog,
} from './lifecycle'
import type { Person } from './parties'
import type { Result } from './result'

// The family (spec §3).
const dad: Person = { id: 1, role: 'giver', active: true }
const older: Person = { id: 2, role: 'taker', active: true }
const younger: Person = { id: 3, role: 'taker', active: true }
const jakub: Person = { id: 4, role: 'admin', active: true }
const exTaker: Person = { id: 6, role: 'taker', active: false }
const exGiver: Person = { id: 7, role: 'giver', active: false }

const DAD = byPerson(dad)
const OLDER = byPerson(older)
const YOUNGER = byPerson(younger)
const JAKUB = byPerson(jakub)

const at = (iso: string) => new Date(iso)
const T0 = at('2026-11-17T04:00:00.000Z')
// Bins: due Tuesday 07:00, grace until 09:00.
const bins: Deadline = {
  dueAt: at('2026-11-17T06:00:00.000Z'),
  graceEndsAt: at('2026-11-17T08:00:00.000Z'),
}
const BEFORE_DUE = at('2026-11-17T05:00:00.000Z')
const IN_GRACE = at('2026-11-17T07:30:00.000Z')
const GRACE_END = bins.graceEndsAt
const AFTER_GRACE = at('2026-11-17T08:00:00.001Z')

function value<T>(result: Result<T, LifecycleError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, LifecycleError>): LifecycleError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

// Builders for each state.
const negotiating = (approvalRequired = true): Item =>
  value(createOneTimeItem(DAD, approvalRequired))
const openTask = (approvalRequired = true): Item =>
  value(markAgreed(negotiating(approvalRequired), null))
const openInstance = (deadline: Deadline | null = null, approvalRequired = true): Item =>
  value(createInstance(DAD, 'on_demand', approvalRequired, deadline))
const reservedByTap = (item: Item = openTask(), who: Actor = OLDER): Item =>
  value(reserve(item, who, T0))
const reservedByBid = (): Item => value(markAgreed(negotiating(), older.id))
const pending = (item: Item = openTask()): Item => value(complete(item, OLDER, T0))
const confirmed = (): Item => value(approve(pending(), DAD))
const selfLogged = (): Item => value(selfLog(OLDER, T0))
const expired = (): Item => value(expire(openInstance(bins), SYSTEM, AFTER_GRACE))
const cancelled = (): Item => value(cancel(openTask(), DAD))
const rejectedSelfLog = (): Item => value(reject(selfLogged(), DAD))

const every: Record<ItemStatus, () => Item> = {
  negotiating: () => negotiating(),
  open: () => openTask(),
  reserved: () => reservedByTap(),
  done_unconfirmed: () => pending(),
  confirmed,
  expired,
  cancelled,
  rejected: rejectedSelfLog,
}
const statuses = Object.keys(every) as ItemStatus[]
const others = (...allowed: ItemStatus[]) => statuses.filter((s) => !allowed.includes(s))

describe('creation (spec §5.2, §5.3, §5.5)', () => {
  it('a giver creates a one-time task in negotiation, approval on by default [call]', () => {
    expect(DEFAULT_APPROVAL_REQUIRED).toBe(true)
    expect(value(createOneTimeItem(DAD))).toEqual({
      origin: 'one_time',
      approvalRequired: true,
      deadline: null,
      status: 'negotiating',
    })
    expect(value(createOneTimeItem(DAD, false)).approvalRequired).toBe(false)
  })

  it('only an active giver creates one-time tasks', () => {
    for (const actor of [OLDER, JAKUB, byPerson(exGiver), SYSTEM]) {
      expect(error(createOneTimeItem(actor))).toBe('not_a_giver')
    }
  })

  it('instances are born open, skipping negotiation (spec §5.6)', () => {
    expect(value(createInstance(SYSTEM, 'scheduled', true, bins))).toEqual({
      origin: 'scheduled',
      approvalRequired: true,
      deadline: bins,
      status: 'open',
    })
    expect(value(createInstance(DAD, 'on_demand', false, null)).status).toBe('open')
  })

  it('scheduled instances come only from the scheduler; on-demand only from a giver', () => {
    expect(error(createInstance(DAD, 'scheduled', true, null))).toBe('not_allowed')
    for (const actor of [OLDER, JAKUB, SYSTEM, byPerson(exGiver)]) {
      expect(error(createInstance(actor, 'on_demand', true, null))).toBe('not_a_giver')
    }
  })

  it('grace may not end before the due time; a zero grace window is fine', () => {
    const backwards = { dueAt: bins.graceEndsAt, graceEndsAt: bins.dueAt }
    expect(error(createInstance(SYSTEM, 'scheduled', true, backwards))).toBe('invalid_deadline')
    const noGrace = { dueAt: bins.dueAt, graceEndsAt: bins.dueAt }
    expect(value(createInstance(SYSTEM, 'scheduled', true, noGrace)).deadline).toEqual(noGrace)
  })

  it('a taker self-logs a chore: done, unconfirmed, always needs approval (spec §5.3)', () => {
    expect(selfLogged()).toEqual({
      origin: 'self_logged',
      approvalRequired: true,
      deadline: null,
      status: 'done_unconfirmed',
      completion: { completedBy: older.id, completedAt: T0, earner: older.id, reservation: null },
    })
  })

  it('only an active taker self-logs', () => {
    for (const actor of [DAD, JAKUB, SYSTEM, byPerson(exTaker)]) {
      expect(error(selfLog(actor, T0))).toBe('not_a_taker')
    }
  })
})

describe('agreement ends negotiation (spec §5.2)', () => {
  it('score agreement opens the task', () => {
    expect(openTask().status).toBe('open')
  })

  it('a won bid reserves the task to that taker', () => {
    const item = reservedByBid()
    expect(item.status === 'reserved' && item.reservation).toEqual({
      takerId: older.id,
      via: 'bid',
    })
  })

  it.each(others('negotiating'))('not from %s', (status) => {
    expect(error(markAgreed(every[status](), null))).toBe('wrong_state')
  })
})

describe('reserve (spec §5.4)', () => {
  it('a taker reserves an open task or instance', () => {
    const item = reservedByTap(openInstance())
    expect(item.status === 'reserved' && item.reservation).toEqual({
      takerId: older.id,
      via: 'tap',
    })
  })

  it('only an active taker reserves', () => {
    for (const actor of [DAD, JAKUB, SYSTEM, byPerson(exTaker)]) {
      expect(error(reserve(openTask(), actor, T0))).toBe('not_a_taker')
    }
  })

  it.each(others('open'))('not from %s', (status) => {
    expect(error(reserve(every[status](), OLDER, T0))).toBe('wrong_state')
  })

  it('not once the grace window is over', () => {
    expect(value(reserve(openInstance(bins), OLDER, IN_GRACE)).status).toBe('reserved')
    expect(error(reserve(openInstance(bins), OLDER, GRACE_END))).toBe('past_grace')
  })
})

describe('release (spec §5.4)', () => {
  it('[call] the taker releases their own reservation: back to open', () => {
    expect(value(release(reservedByTap(), OLDER)).status).toBe('open')
  })

  it('[call] a giver releases anyone’s reservation', () => {
    expect(value(release(reservedByTap(), DAD)).status).toBe('open')
  })

  it('another taker, the admin, the system or an ex-giver may not', () => {
    for (const actor of [YOUNGER, JAKUB, SYSTEM, byPerson(exGiver)]) {
      expect(error(release(reservedByTap(), actor))).toBe('not_allowed')
    }
  })

  it('a deactivated taker cannot release, a giver can', () => {
    const item = reservedByTap(openTask(), byPerson({ ...exTaker, active: true }))
    expect(error(release(item, byPerson(exTaker)))).toBe('not_allowed')
    expect(value(release(item, DAD)).status).toBe('open')
  })

  it('[call] releasing a bid-won task returns it to negotiation', () => {
    expect(value(release(reservedByBid(), OLDER)).status).toBe('negotiating')
    expect(value(release(reservedByBid(), DAD)).status).toBe('negotiating')
  })

  it('an instance keeps its deadline when released', () => {
    expect(value(release(reservedByTap(openInstance(bins)), OLDER)).deadline).toEqual(bins)
  })

  it.each(others('reserved'))('not from %s', (status) => {
    expect(error(release(every[status](), DAD))).toBe('wrong_state')
  })
})

describe('complete (spec §5.4, §5.5)', () => {
  it('approval on: a taker’s completion is pending, with completedAt and the earner', () => {
    expect(pending()).toEqual({
      origin: 'one_time',
      approvalRequired: true,
      deadline: null,
      status: 'done_unconfirmed',
      completion: { completedBy: older.id, completedAt: T0, earner: older.id, reservation: null },
    })
  })

  it('approval off: confirmed at once', () => {
    const item = value(complete(openTask(false), OLDER, T0))
    expect(item.status).toBe('confirmed')
    expect(confirmedEarner(item)).toBe(older.id)
  })

  it('anyone completes an open item without reserving it first', () => {
    expect(value(complete(openInstance(), YOUNGER, T0)).status).toBe('done_unconfirmed')
  })

  it('a reserved item: only its taker completes it for points', () => {
    const item = value(complete(reservedByTap(), OLDER, T0))
    expect(item.status === 'done_unconfirmed' && item.completion.reservation).toEqual({
      takerId: older.id,
      via: 'tap',
    })
    expect(error(complete(reservedByTap(), YOUNGER, T0))).toBe('reserved_by_other')
  })

  it('[call] a giver closes it with no points and no approval, even if reserved', () => {
    for (const item of [openTask(), reservedByTap(), reservedByBid()]) {
      const done = value(complete(item, DAD, T0))
      expect(done.status).toBe('confirmed')
      expect(confirmedEarner(done)).toBeNull()
    }
  })

  it('the admin, the system and inactive people do not complete', () => {
    for (const actor of [JAKUB, SYSTEM, byPerson(exTaker), byPerson(exGiver)]) {
      expect(error(complete(openTask(), actor, T0))).toBe('not_allowed')
    }
  })

  it.each(others('open', 'reserved'))('not from %s', (status) => {
    expect(error(complete(every[status](), OLDER, T0))).toBe('wrong_state')
  })

  it('a deadline instance: before due and in grace are fine; from the grace end on, too late', () => {
    expect(value(complete(openInstance(bins), OLDER, BEFORE_DUE)).status).toBe('done_unconfirmed')
    expect(value(complete(openInstance(bins), OLDER, IN_GRACE)).status).toBe('done_unconfirmed')
    expect(error(complete(openInstance(bins), OLDER, GRACE_END))).toBe('past_grace')
    expect(error(complete(openInstance(bins), DAD, AFTER_GRACE))).toBe('past_grace')
  })
})

describe('approve and reject (spec §5.5)', () => {
  it('a giver approves: confirmed, points count for the taker', () => {
    const item = confirmed()
    expect(item.status).toBe('confirmed')
    expect(confirmedEarner(item)).toBe(older.id)
    expect(pendingEarner(item)).toBeNull()
  })

  it('a giver approves a self-logged chore', () => {
    expect(confirmedEarner(value(approve(selfLogged(), DAD)))).toBe(older.id)
  })

  it('rejecting an unreserved completion: back to open', () => {
    const item = value(reject(pending(), DAD))
    expect(item).toEqual({
      origin: 'one_time',
      approvalRequired: true,
      deadline: null,
      status: 'open',
    })
  })

  it('rejecting a reserved completion: back to reserved by the same taker, same way', () => {
    const tap = value(reject(pending(reservedByTap()), DAD))
    expect(tap.status === 'reserved' && tap.reservation).toEqual({ takerId: older.id, via: 'tap' })
    const bid = value(reject(pending(reservedByBid()), DAD))
    expect(bid.status === 'reserved' && bid.reservation).toEqual({ takerId: older.id, via: 'bid' })
  })

  it('rejecting an instance keeps its deadline', () => {
    expect(value(reject(pending(openInstance(bins)), DAD)).deadline).toEqual(bins)
  })

  it('[call] rejecting a self-logged chore closes it as rejected, no points', () => {
    const item = rejectedSelfLog()
    expect(item.status).toBe('rejected')
    expect(confirmedEarner(item)).toBeNull()
    expect(pendingEarner(item)).toBeNull()
  })

  it('only an active giver approves or rejects', () => {
    for (const actor of [OLDER, JAKUB, SYSTEM, byPerson(exGiver)]) {
      expect(error(approve(pending(), actor))).toBe('not_a_giver')
      expect(error(reject(pending(), actor))).toBe('not_a_giver')
    }
  })

  it.each(others('done_unconfirmed'))('not from %s', (status) => {
    expect(error(approve(every[status](), DAD))).toBe('wrong_state')
    expect(error(reject(every[status](), DAD))).toBe('wrong_state')
  })

  it('pending points count for the taker until decided', () => {
    expect(pendingEarner(pending())).toBe(older.id)
    expect(confirmedEarner(pending())).toBeNull()
  })
})

describe('expire (spec §5.3)', () => {
  it('the scheduler expires an open or reserved deadline item after its grace window', () => {
    expect(value(expire(openInstance(bins), SYSTEM, GRACE_END)).status).toBe('expired')
    expect(value(expire(reservedByTap(openInstance(bins)), SYSTEM, AFTER_GRACE)).status).toBe(
      'expired',
    )
  })

  it('not before the grace window is over', () => {
    expect(error(expire(openInstance(bins), SYSTEM, IN_GRACE))).toBe('grace_not_over')
  })

  it('not without a deadline', () => {
    expect(error(expire(openInstance(), SYSTEM, AFTER_GRACE))).toBe('no_deadline')
  })

  it('only the scheduler expires', () => {
    expect(error(expire(openInstance(bins), DAD, AFTER_GRACE))).toBe('not_allowed')
  })

  it.each(others('open', 'reserved'))('not from %s', (status) => {
    expect(error(expire(every[status](), SYSTEM, AFTER_GRACE))).toBe('wrong_state')
  })

  it('a pending completion made in grace does not expire', () => {
    expect(error(expire(pending(openInstance(bins)), SYSTEM, AFTER_GRACE))).toBe('wrong_state')
  })
})

describe('cancel (spec §5.6) [call]', () => {
  it.each(['negotiating', 'open', 'reserved'] as const)('a giver cancels from %s', (status) => {
    expect(value(cancel(every[status](), DAD)).status).toBe('cancelled')
  })

  it('only an active giver cancels', () => {
    for (const actor of [OLDER, JAKUB, SYSTEM, byPerson(exGiver)]) {
      expect(error(cancel(openTask(), actor))).toBe('not_a_giver')
    }
  })

  it.each(others('negotiating', 'open', 'reserved'))('not from %s', (status) => {
    expect(error(cancel(every[status](), DAD))).toBe('wrong_state')
  })
})

describe('end to end', () => {
  it('bid won → released → agreed again → reserved by tap → done → rejected → done → approved', () => {
    let item = reservedByBid()
    item = value(release(item, OLDER))
    item = value(markAgreed(item, null))
    item = value(reserve(item, YOUNGER, T0))
    item = value(complete(item, YOUNGER, T0))
    item = value(reject(item, DAD))
    expect(item.status === 'reserved' && item.reservation.takerId).toBe(younger.id)
    item = value(complete(item, YOUNGER, IN_GRACE))
    item = value(approve(item, DAD))
    expect(confirmedEarner(item)).toBe(younger.id)
    expect(item.status === 'confirmed' && item.completion.completedAt).toEqual(IN_GRACE)
  })
})
