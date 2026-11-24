import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import type { FixTaker } from '~/server/corrections/functions'
import {
  belowZero,
  fixRequest,
  initialDraft,
  pointsAmount,
  pointsPreview,
  sendLabel,
  weekDifference,
} from './fixDraft'
import type { FixStart } from './fixDraft'

// The fix sheet's state rules (#48): what it sends, previews and names. Pure, so each is pinned.

const week = {
  settlementId: 7,
  startsAt: '2026-11-14T19:00:00.000Z',
  endsAt: '2026-11-21T19:00:00.000Z',
  levels: { lower: 50, upper: 100 },
  totalBefore: 60,
  carryOver: 10,
  level: 'lower' as const,
  deducted: 50,
  corrected: false,
}
const fixable: FixTaker[] = [
  { id: 3, name: 'Starší', total: 62, weeks: [week] },
  { id: 4, name: 'Mladší', total: 4, weeks: [] },
]
const entry = (over: Partial<AdminDisputeEntry>): AdminDisputeEntry => ({
  id: 9,
  item: { kind: 'completion', id: 10 },
  title: 'Vysát auto',
  week: null,
  takerName: 'Starší',
  takerId: 3,
  openedByName: 'Starší',
  reason: 'Víc.',
  openedAt: '2026-11-22T10:00:00.000Z',
  value: { score: 22 },
  ...over,
})
const settlementEntry = entry({
  item: { kind: 'settlement', id: 7 },
  title: '',
  week: { startsAt: week.startsAt, endsAt: week.endsAt },
  value: { level: 'lower', deducted: 50 },
})

const points = (s: FixStart, over: Partial<ReturnType<typeof initialDraft>>) => ({
  ...initialDraft(s, 'Rozbitý hrnek.'),
  ...over,
})

describe('fixDraft', () => {
  const direct: FixStart = { mode: 'points', takerId: null, dispute: null }

  it('points: nothing to send until a boy, a whole number 1–9999 and a reason', () => {
    expect(fixRequest(initialDraft(direct, ''), direct, fixable)).toBeNull()
    expect(fixRequest(points(direct, { amount: '5' }), direct, fixable)).toBeNull() // no boy
    expect(
      fixRequest(points(direct, { takerId: 3, amount: '5', reason: ' ' }), direct, fixable),
    ).toBeNull()
    for (const amount of ['0', '10000', '1.5', '', '-2', 'x']) {
      expect(fixRequest(points(direct, { takerId: 3, amount }), direct, fixable)).toBeNull()
    }
    expect(pointsAmount('1')).toBe(1)
    expect(pointsAmount('9999')).toBe(9999)
    expect(
      fixRequest(points(direct, { takerId: 3, amount: '9999' }), direct, fixable),
    ).not.toBeNull()
  })

  it('points direct: Ubrat sends a negative number and from null', () => {
    expect(
      fixRequest(points(direct, { takerId: 3, amount: '5', sign: -1 }), direct, fixable),
    ).toEqual({
      mode: 'points',
      input: { takerId: 3, points: -5, reason: 'Rozbitý hrnek.', from: null },
    })
  })

  it("points from a completion dispute: the item's boy preselected and the seen value sent", () => {
    const s: FixStart = { mode: 'points', takerId: 3, dispute: entry({}) }
    const d = points(s, { amount: '3' })
    expect(d.takerId).toBe(3)
    expect(fixRequest(d, s, fixable)).toEqual({
      mode: 'points',
      input: {
        takerId: 3,
        points: 3,
        reason: 'Rozbitý hrnek.',
        from: { disputeId: 9, seen: { score: 22 } },
      },
    })
  })

  it('a score dispute names no boy: the admin picks one', () => {
    const s: FixStart = { mode: 'points', takerId: null, dispute: entry({ takerId: null }) }
    expect(initialDraft(s, '').takerId).toBeNull()
  })

  it('points preview and the below-zero warning', () => {
    expect(pointsPreview(points(direct, { takerId: 3, amount: '5', sign: -1 }), fixable)).toBe(
      cs.admin.fix.preview('Starší', 62, 57),
    )
    expect(pointsPreview(points(direct, { takerId: 3, amount: '' }), fixable)).toBeNull()
    expect(belowZero(points(direct, { takerId: 4, amount: '5', sign: -1 }), fixable)).toBe(true)
    expect(belowZero(points(direct, { takerId: 4, amount: '4', sign: -1 }), fixable)).toBe(false)
    expect(belowZero(points(direct, { takerId: 4, amount: '9', sign: 1 }), fixable)).toBe(false)
  })

  it('week from a settlement dispute: its week fixed, the level sent with from', () => {
    const s: FixStart = {
      mode: 'week',
      takerId: 3,
      settlementId: 7,
      dispute: settlementEntry,
    }
    const d = { ...initialDraft(s, 'Chyběl úkol.'), level: 'upper' as const }
    expect(d.settlementId).toBe(7)
    expect(fixRequest(d, s, fixable)).toEqual({
      mode: 'week',
      input: {
        settlementId: 7,
        level: 'upper',
        reason: 'Chyběl úkol.',
        from: { disputeId: 9, seen: { level: 'lower', deducted: 50 } },
      },
    })
    expect(weekDifference(d, fixable)).toBe(-50)
    expect(sendLabel(d, fixable)).toBe(cs.admin.fix.sendCorrect('Horní hranice', 'Starší'))
  })

  it('week direct: no week or no level → nothing to send; the current level is no change', () => {
    const s: FixStart = { mode: 'week', takerId: null, settlementId: null, dispute: null }
    const d = initialDraft(s, 'Chyběl úkol.')
    expect(fixRequest({ ...d, takerId: 3, level: 'upper' }, s, fixable)).toBeNull()
    expect(fixRequest({ ...d, takerId: 3, settlementId: 7 }, s, fixable)).toBeNull()
    expect(fixRequest({ ...d, takerId: 3, settlementId: 7, level: 'lower' }, s, fixable)).toBeNull()
    expect(fixRequest({ ...d, takerId: 3, settlementId: 7, level: 'none' }, s, fixable)).toEqual({
      mode: 'week',
      input: { settlementId: 7, level: 'none', reason: 'Chyběl úkol.', from: null },
    })
    expect(weekDifference({ ...d, takerId: 3, settlementId: 7, level: 'none' }, fixable)).toBe(50)
  })

  it('send labels name the action and the boy', () => {
    expect(sendLabel(points(direct, { takerId: 3, amount: '5' }), fixable)).toBe(
      cs.admin.fix.sendAdd(5, 'Starší'),
    )
    expect(sendLabel(points(direct, { takerId: 3, amount: '5', sign: -1 }), fixable)).toBe(
      cs.admin.fix.sendRemove(5, 'Starší'),
    )
    expect(sendLabel(points(direct, { takerId: null, amount: '5' }), fixable)).toBeNull()
  })
})
