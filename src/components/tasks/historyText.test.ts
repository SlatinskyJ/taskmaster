import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '~/server/tasks/functions'
import { historyLine, historyReason, historyTime } from './historyText'

const AT = '2026-11-21T09:12:00.000Z'
const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 1,
  at: AT,
  action: 'task.created',
  by: { id: 2, name: 'Táta' },
  score: 8,
  reservedBy: null,
  reason: null,
  ...over,
})

describe('historyTime', () => {
  it('Prague time in winter and in summer', () => {
    expect(historyTime(AT)).toBe('so 21. 11. 10:12')
    expect(historyTime('2026-07-04T09:12:00.000Z')).toBe('so 4. 7. 11:12')
    // Single-digit hour and minute keep their leading zero.
    expect(historyTime('2026-11-21T07:05:00.000Z')).toBe('so 21. 11. 08:05')
  })
})

describe('historyLine', () => {
  it.each<[HistoryEntry['action'], string]>([
    ['task.created', 'nový úkol za 8 b'],
    ['task.score_countered', 'nabídka 8 b'],
    ['task.bid_placed', 'chce 8 b'],
    ['task.bid_accepted', 'přijato 8 b'],
    ['task.score_approved', 'souhlas s 8 b'],
    ['task.agreed', 'domluveno za 8 b'],
    ['task.reserved', 'rezervace'],
    ['task.released', 'uvolněno'],
    ['task.completed', 'hotovo'],
    ['task.approved', 'schváleno'],
    ['task.rejected', 'vráceno'],
    ['task.cancelled', 'zrušeno'],
    ['task.score_change_proposed', 'návrh nové ceny 8 b'],
    ['task.score_change_approved', 'souhlas s novou cenou 8 b'],
    ['task.score_change_declined', 'nesouhlas s novou cenou 8 b'],
    ['task.score_change_withdrawn', 'návrh ceny stažen'],
    ['task.score_changed', 'nová cena 8 b'],
    ['task.score_change_discarded', 'návrh ceny 8 b propadl'],
    ['instance.created', 'přidáno za 8 b'],
    ['instance.self_logged', 'zapsáno za 8 b'],
  ])('%s', (action, text) => {
    expect(historyLine(entry({ action }), 9)).toBe(`so 21. 11. 10:12 · Táta: ${text}`)
  })

  it('names me "ty", leaves out the system, and names who an agreement reserved it to', () => {
    expect(historyLine(entry({}), 2)).toBe('so 21. 11. 10:12 · ty: nový úkol za 8 b')
    expect(historyLine(entry({ action: 'task.score_approved', by: null }), 2)).toBe(
      'so 21. 11. 10:12 · souhlas s 8 b',
    )
    const agreed = entry({ action: 'task.agreed', reservedBy: { id: 3, name: 'Starší' } })
    expect(historyLine(agreed, 9)).toBe(
      'so 21. 11. 10:12 · Táta: domluveno za 8 b · rezervace: Starší',
    )
    expect(historyLine(agreed, 3)).toBe('so 21. 11. 10:12 · Táta: domluveno za 8 b · rezervace: ty')
  })

  it('the old offer action reads as an offer', () => {
    expect(historyLine(entry({ action: 'task.score_offered' }), 9)).toContain('nabídka 8 b')
  })

  it('the reason in Czech quotes, none when empty', () => {
    expect(historyReason(entry({ reason: 'Udělá to firma.' }))).toBe('„Udělá to firma.“')
    expect(historyReason(entry({}))).toBeNull()
  })
})
