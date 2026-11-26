import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '~/server/tasks/functions'
import { historyLine, historyReason, historyRounds, historyTime } from './historyText'

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
    ['task.bid_withdrawn', 'nabídka stažena'],
    ['task.bids_turned_down', 'nabídky odmítnuty'],
    ['task.bidding_reopened', 'nové vyjednávání o ceně'],
    ['task.bidding_closed', 'vyjednávání skončilo'],
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
    ['instance.expired', 'prošlo'],
  ])('%s', (action, text) => {
    expect(historyLine(entry({ action }), 9)).toBe(`so 21. 11. 10:12 · Táta: ${text}`)
  })

  it('the scheduler: a scheduled instance is "added by the schedule", an expired one "prošlo" (#39)', () => {
    expect(historyLine(entry({ action: 'instance.created', by: null, score: 4 }), 2)).toBe(
      'so 21. 11. 10:12 · přidáno podle rozvrhu za 4 b',
    )
    expect(historyLine(entry({ action: 'instance.expired', by: null }), 2)).toBe(
      'so 21. 11. 10:12 · prošlo',
    )
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

describe('historyRounds (#212, Jakub 2026-11-26)', () => {
  const at = (id: number, action: HistoryEntry['action']) => entry({ id, action })
  it('no reopen: no round dividers', () => {
    expect([...historyRounds([at(1, 'task.created'), at(2, 'task.bid_placed')])]).toEqual([])
    expect([...historyRounds([])]).toEqual([])
  })
  it('the first entry starts round 1, each reopen the next; old bids stay in the list', () => {
    const entries = [
      at(1, 'task.created'),
      at(2, 'task.bid_placed'),
      at(3, 'task.agreed'),
      at(4, 'task.bidding_reopened'),
      at(5, 'task.bid_placed'),
      at(6, 'task.bids_turned_down'),
      at(7, 'task.bidding_reopened'),
    ]
    expect([...historyRounds(entries)]).toEqual([
      [1, 1],
      [4, 2],
      [7, 3],
    ])
  })
})

describe('historyLine: descriptions (#207)', () => {
  it.each([
    ['task.description_changed', 'nový popis'],
    ['task.description_change_proposed', 'návrh nového popisu'],
    ['task.description_change_approved', 'souhlas s novým popisem'],
    ['task.description_change_declined', 'nesouhlas s novým popisem'],
    ['task.description_change_withdrawn', 'návrh popisu stažen'],
  ] as const)('%s → "Táta: %s"', (action, text) => {
    expect(historyLine(entry({ action, score: null }), 9)).toBe(`so 21. 11. 10:12 · Táta: ${text}`)
  })

  it('a discarded change by nobody has no name', () => {
    const e = entry({ action: 'task.description_change_discarded', by: null, score: null })
    expect(historyLine(e, 9)).toBe('so 21. 11. 10:12 · návrh popisu propadl')
  })
})
