import { describe, expect, it } from 'vitest'
import { fromPragueWallTime } from '~/domain/dates'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import type { PlanCopy, PlanRow, WeekPlan } from '~/server/instances/functions'
import {
  cellKind,
  cellLabel,
  dayHeader,
  freeCount,
  isPast,
  listRowAction,
  listRowLabel,
  reserveErrorMessage,
  rowMeta,
  tapAction,
} from './planView'
import type { CellKind, Viewer } from './planView'

// The plan table's cell rules (#258).

const ME: Viewer = { id: 3, role: 'taker' }
const BRO = 4
const GIVER: Viewer = { id: 2, role: 'giver' }
const day = (d: number, month = 12) =>
  fromPragueWallTime({ year: 2026, month, day: d, hour: 0, minute: 0 }).toISOString()
const WED = day(2)

const copy = (over: Partial<PlanCopy> = {}): PlanCopy => ({
  id: 1,
  status: 'open',
  score: 2,
  origin: 'scheduled',
  createdAt: '2026-11-30T09:00:00.000Z',
  person: null,
  ...over,
})
const held = (id: number, name = 'Mladší') => copy({ status: 'reserved', person: { id, name } })

describe('cellKind', () => {
  it('blank, free, reserved (mine / the brother’s / for a parent), pending, confirmed, expired, cancelled', () => {
    expect(cellKind([], ME)).toEqual({ kind: 'blank' })
    expect(cellKind([copy()], ME)).toEqual({ kind: 'free', copy: copy() })
    expect(cellKind([held(3)], ME)).toMatchObject({ kind: 'reserved', mine: true })
    expect(cellKind([held(BRO)], ME)).toMatchObject({ kind: 'reserved', mine: false })
    expect(cellKind([held(2)], GIVER)).toMatchObject({ kind: 'reserved', mine: false })
    expect(cellKind([copy({ status: 'done_unconfirmed' })], ME).kind).toBe('pending')
    expect(cellKind([copy({ status: 'confirmed' })], ME).kind).toBe('confirmed')
    expect(cellKind([copy({ status: 'expired' })], ME).kind).toBe('expired')
    expect(cellKind([copy({ status: 'cancelled' })], ME).kind).toBe('cancelled')
  })

  it('boundary: one copy is its state, two are a count', () => {
    expect(cellKind([held(3)], ME).kind).toBe('reserved')
    const two = [copy(), copy({ id: 2, origin: 'on_demand' })]
    expect(cellKind(two, ME)).toEqual({ kind: 'count', copies: two })
  })
})

describe('tapAction', () => {
  const k = (c: PlanCopy, v: Viewer = ME) => cellKind([c], v)
  const count: CellKind = { kind: 'count', copies: [copy(), copy({ id: 2 })] }

  it('a brother: free reserves, his own opens the Uvolnit sheet, the rest open the page, a count the list', () => {
    expect(tapAction(k(copy()), ME)).toBe('reserve')
    expect(tapAction(k(held(3)), ME)).toBe('releaseSheet')
    for (const c of [
      held(BRO),
      copy({ status: 'done_unconfirmed' }),
      copy({ status: 'confirmed' }),
      copy({ status: 'expired' }),
      copy({ status: 'cancelled' }),
    ])
      expect(tapAction(k(c), ME), c.status).toBe('open')
    expect(tapAction(count, ME)).toBe('list')
  })

  it('a parent never reserves or gets a sheet: free and reserved open the page, a count the list', () => {
    expect(tapAction(k(copy(), GIVER), GIVER)).toBe('open')
    expect(tapAction(k(held(BRO), GIVER), GIVER)).toBe('open')
    expect(tapAction(count, GIVER)).toBe('list')
  })

  it('blank: nothing', () => {
    expect(tapAction({ kind: 'blank' }, ME)).toBeNull()
  })
})

describe('listRowAction', () => {
  it('a brother reserves a free row, releases his own, opens the brother’s; a parent opens', () => {
    expect(listRowAction(copy(), ME)).toBe('reserve')
    expect(listRowAction(held(3), ME)).toBe('release')
    expect(listRowAction(held(BRO), ME)).toBe('open')
    expect(listRowAction(copy(), GIVER)).toBe('open')
  })
})

describe('isPast', () => {
  it('boundary: yesterday is past, today and tomorrow are not', () => {
    expect(isPast(day(1), WED)).toBe(true)
    expect(isPast(WED, WED)).toBe(false)
    expect(isPast(day(3), WED)).toBe(false)
  })
})

describe('freeCount', () => {
  it('open copies from today on; yesterday and reserved ones do not count', () => {
    const row = (cells: PlanCopy[][]): PlanRow => ({
      templateId: 1,
      title: 'x',
      scheduleDays: [0, 1, 2, 3, 4, 5, 6],
      cells,
    })
    const plan: WeekPlan = {
      period: { startsAt: day(1), cutoffAt: day(6) },
      today: WED,
      days: [day(1), WED, day(3)],
      rows: [row([[copy()], [copy(), held(BRO)], [copy()]]), row([[], [copy()], []])],
    }
    expect(freeCount(plan)).toBe(3)
  })
})

describe('labels', () => {
  it('dayHeader: St 2. 12.', () => {
    expect(dayHeader(WED)).toEqual({ weekday: 'St', date: '2. 12.' })
  })

  it('rowMeta: every day, or the days', () => {
    const r = (scheduleDays: PlanRow['scheduleDays']): PlanRow => ({
      templateId: 1,
      title: 'x',
      scheduleDays,
      cells: [],
    })
    expect(rowMeta(r([0, 1, 2, 3, 4, 5, 6]))).toBe('každý den')
    expect(rowMeta(r([2, 5]))).toBe('Út, Pá')
  })

  it('cellLabel: the full title, the day and the state', () => {
    const t = 'Prostřít stůl k večeři'
    expect(cellLabel(t, WED, cellKind([copy()], ME), ME)).toBe(
      'Prostřít stůl k večeři, St: volné, rezervovat',
    )
    expect(cellLabel(t, WED, cellKind([held(3)], ME), ME)).toBe(
      'Prostřít stůl k večeři, St: rezervováno tebou, uvolnit',
    )
    expect(cellLabel(t, WED, cellKind([held(BRO)], ME), ME)).toBe(
      'Prostřít stůl k večeři, St: rezervováno, Mladší',
    )
    expect(cellLabel(t, WED, cellKind([copy(), copy({ id: 2 })], ME), ME)).toBe(
      'Prostřít stůl k večeři, St: 2 kopie, otevřít seznam',
    )
    const five = [1, 2, 3, 4, 5].map((id) => copy({ id }))
    expect(cellLabel(t, WED, cellKind(five, ME), ME)).toBe(
      'Prostřít stůl k večeři, St: 5 kopií, otevřít seznam',
    )
    expect(cellLabel(t, WED, cellKind([copy()], GIVER), GIVER)).toBe(
      'Prostřít stůl k večeři, St: volné',
    )
    const did = copy({ status: 'confirmed', person: { id: 3, name: 'Starší' } })
    expect(cellLabel(t, WED, cellKind([did], ME), ME)).toBe(
      'Prostřít stůl k večeři, St: hotovo, Starší',
    )
  })

  it('listRowLabel: where the copy came from, its state, and the button', () => {
    expect(listRowLabel(held(3, 'Starší'), ME)).toEqual({
      what: 'Podle rozvrhu · rezervováno tebou',
      action: 'Uvolnit',
    })
    // 14:20 Prague = 13:20 UTC in winter.
    const extra = copy({ origin: 'on_demand', createdAt: '2026-12-02T13:20:00.000Z' })
    expect(listRowLabel(extra, ME)).toEqual({ what: 'Navíc 14:20 · Volné', action: 'Rezervovat' })
    expect(listRowLabel(extra, GIVER)).toEqual({ what: 'Navíc 14:20 · Volné', action: null })
    expect(listRowLabel(held(BRO), ME)).toEqual({
      what: 'Podle rozvrhu · rezervováno: Mladší',
      action: null,
    })
  })
})

describe('reserveErrorMessage', () => {
  it('a lost race (wrong_state) says a brother took it; the rest as everywhere', () => {
    expect(reserveErrorMessage('wrong_state')).toBe(cs.tasks.errors.reservedByOther)
    expect(reserveErrorMessage('not_found')).toBe(taskErrorMessage('not_found'))
  })
})
