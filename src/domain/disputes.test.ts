import { describe, expect, it } from 'vitest'
import type { Dispute, DisputeCorrection, DisputeError, DisputeTarget } from './disputes'
import { correctDispute, dismissDispute, isDisputed, isLocked, openDispute } from './disputes'
import type { Person } from './parties'
import type { Result } from './result'

const DAD = 1
const OLDER = 2
const YOUNGER = 3
const JAKUB = 4
const family: Person[] = [
  { id: DAD, role: 'giver', active: true },
  { id: OLDER, role: 'taker', active: true },
  { id: YOUNGER, role: 'taker', active: true },
  { id: JAKUB, role: 'admin', active: true },
]

function value<T>(result: Result<T, DisputeError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, DisputeError>): DisputeError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

const SETTLEMENT: DisputeTarget = { kind: 'settlement', id: 7, periodId: 46, takerId: OLDER }
const SETTLEMENT_REF = { kind: 'settlement', id: 7, periodId: 46, takerId: OLDER } as const
const fix = (periodId = 46, takerId = OLDER): DisputeCorrection => ({
  kind: 'settlement_correction',
  correction: {
    periodId,
    takerId,
    originalLevel: 'lower',
    originalDeducted: 50,
    correctedLevel: 'lower',
    correctedDeducted: 45,
    reason: 'Chyběla myčka',
  },
})
const ADJ: DisputeCorrection = {
  kind: 'adjustment',
  adjustment: { takerId: OLDER, points: 10, reason: '+10 za koš' },
}
const open = (target: DisputeTarget = SETTLEMENT, by = OLDER, existing: Dispute[] = []) =>
  openDispute(family, by, target, 'Vyndat myčku chybí v součtu', existing)

describe('locked items (spec §5.11)', () => {
  it.each<[string, DisputeTarget, boolean]>([
    ['agreed task score (open)', { kind: 'task_score', id: 1, agreement: 'open' }, true],
    ['agreed task score (reserved)', { kind: 'task_score', id: 1, agreement: 'reserved' }, true],
    ['task still negotiating', { kind: 'task_score', id: 1, agreement: 'proposed' }, false],
    ['agreed template score', { kind: 'template_score', id: 2, agreement: 'agreed' }, true],
    ['template not yet agreed', { kind: 'template_score', id: 2, agreement: 'proposed' }, false],
    ['confirmed completion', { kind: 'completion', id: 3, outcome: 'confirmed' }, true],
    ['rejected completion', { kind: 'completion', id: 3, outcome: 'rejected' }, true],
    ['pending completion', { kind: 'completion', id: 3, outcome: 'pending' }, false],
    ['settlement record', { kind: 'settlement', id: 4, periodId: 46, takerId: OLDER }, true],
    ['manual adjustment', { kind: 'adjustment', id: 5 }, true],
  ])('%s → locked: %s', (_, target, locked) => {
    expect(isLocked(target)).toBe(locked)
  })
})

describe('opening a dispute', () => {
  it('a taker opens one with a reason; it records only the item reference', () => {
    expect(value(open())).toEqual({
      item: SETTLEMENT_REF,
      openedBy: OLDER,
      reason: 'Vyndat myčku chybí v součtu',
      status: 'open',
    })
  })

  it('a giver may open one too', () => {
    expect(value(open(SETTLEMENT, DAD)).openedBy).toBe(DAD)
  })

  it('the admin is not a party and cannot open one; nor can an unknown id', () => {
    expect(error(open(SETTLEMENT, JAKUB))).toBe('not_a_party')
    expect(error(open(SETTLEMENT, 99))).toBe('not_a_party')
  })

  it('refused on an item that is not locked', () => {
    expect(error(open({ kind: 'completion', id: 3, outcome: 'pending' }))).toBe('not_locked')
    expect(error(open({ kind: 'task_score', id: 1, agreement: 'proposed' }))).toBe('not_locked')
  })

  it('needs a reason; the reason is trimmed', () => {
    expect(error(openDispute(family, OLDER, SETTLEMENT, '   ', []))).toBe('reason_required')
    expect(value(openDispute(family, OLDER, SETTLEMENT, '  málo bodů ', [])).reason).toBe(
      'málo bodů',
    )
  })

  it('[call] one open dispute per item; other items and closed disputes do not block', () => {
    const first = value(open())
    expect(error(open(SETTLEMENT, YOUNGER, [first]))).toBe('dispute_open')
    // Same id, different kind = a different item.
    expect(open({ kind: 'adjustment', id: 7 }, YOUNGER, [first]).ok).toBe(true)
    const dismissed = value(dismissDispute(first, family, JAKUB, 'Součet sedí'))
    expect(open(SETTLEMENT, YOUNGER, [dismissed]).ok).toBe(true)
  })

  it('isDisputed shows only open disputes on that item', () => {
    const first = value(open())
    expect(isDisputed(SETTLEMENT_REF, [first])).toBe(true)
    expect(isDisputed({ ...SETTLEMENT_REF, id: 8 }, [first])).toBe(false)
    const closed = value(dismissDispute(first, family, JAKUB, 'ok'))
    expect(isDisputed(SETTLEMENT_REF, [closed])).toBe(false)
  })
})

describe('resolving a dispute (admin only)', () => {
  it('dismiss: with a note, the item untouched', () => {
    const d = value(open())
    expect(value(dismissDispute(d, family, JAKUB, ' Součet sedí '))).toEqual({
      ...d,
      status: 'dismissed',
      resolvedBy: JAKUB,
      note: 'Součet sedí',
    })
  })

  it('correct a settlement by a settlement correction', () => {
    const d = value(open())
    expect(value(correctDispute(d, family, JAKUB, fix(), 'Chyběla myčka'))).toEqual({
      ...d,
      status: 'corrected',
      resolvedBy: JAKUB,
      correction: fix(),
      note: 'Chyběla myčka',
    })
  })

  it('correct any item by an adjustment', () => {
    const d = value(open({ kind: 'completion', id: 3, outcome: 'rejected' }))
    expect(value(correctDispute(d, family, JAKUB, ADJ, '+10 za koš'))).toMatchObject({
      status: 'corrected',
      correction: ADJ,
    })
  })

  it('a settlement correction only fits a disputed settlement', () => {
    const d = value(open({ kind: 'template_score', id: 2, agreement: 'agreed' }))
    expect(error(correctDispute(d, family, JAKUB, fix(), 'x'))).toBe('wrong_correction')
  })

  it('a settlement correction for another period or taker is refused', () => {
    const d = value(open())
    expect(error(correctDispute(d, family, JAKUB, fix(47), 'x'))).toBe('wrong_correction')
    expect(error(correctDispute(d, family, JAKUB, fix(46, YOUNGER), 'x'))).toBe('wrong_correction')
  })

  it('givers, takers and unknown ids cannot resolve', () => {
    const d = value(open())
    expect(error(dismissDispute(d, family, DAD, 'ok'))).toBe('not_admin')
    expect(error(correctDispute(d, family, OLDER, ADJ, 'ok'))).toBe('not_admin')
    expect(error(dismissDispute(d, family, 99, 'ok'))).toBe('not_admin')
    expect(error(correctDispute(d, family, 99, ADJ, 'ok'))).toBe('not_admin')
  })

  it('a note is required for both outcomes', () => {
    const d = value(open())
    expect(error(dismissDispute(d, family, JAKUB, ''))).toBe('note_required')
    expect(error(correctDispute(d, family, JAKUB, ADJ, ' '))).toBe('note_required')
  })

  it.each([
    ['dismissed', (d: Dispute) => dismissDispute(d, family, JAKUB, 'ok')],
    ['corrected', (d: Dispute) => correctDispute(d, family, JAKUB, ADJ, 'ok')],
  ] as const)('a %s dispute is closed: not resolvable again, not shown, no block', (_, close) => {
    const d = value(close(value(open())))
    expect(error(dismissDispute(d, family, JAKUB, 'again'))).toBe('not_open')
    expect(error(correctDispute(d, family, JAKUB, ADJ, 'again'))).toBe('not_open')
    expect(isDisputed(SETTLEMENT_REF, [d])).toBe(false)
    expect(open(SETTLEMENT, YOUNGER, [d]).ok).toBe(true)
  })
})
