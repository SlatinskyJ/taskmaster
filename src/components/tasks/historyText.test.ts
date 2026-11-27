import { describe, expect, it } from 'vitest'
import type { HistoryEntry, ThreadEntry } from '~/server/tasks/functions'
import {
  historyItems,
  historyReason,
  historyRounds,
  historyText,
  historyTime,
  threadItems,
} from './historyText'

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

describe('historyText', () => {
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
    expect(historyText(entry({ action }), 9)).toBe(text)
  })

  it('the scheduler: a scheduled instance is "added by the schedule", an expired one "prošlo" (#39)', () => {
    expect(historyText(entry({ action: 'instance.created', by: null, score: 4 }), 2)).toBe(
      'přidáno podle rozvrhu za 4 b',
    )
    expect(historyText(entry({ action: 'instance.expired', by: null }), 2)).toBe('prošlo')
  })

  it('names who an agreement reserved it to, me as "ty"', () => {
    const agreed = entry({ action: 'task.agreed', reservedBy: { id: 3, name: 'Starší' } })
    expect(historyText(agreed, 9)).toBe('domluveno za 8 b · rezervace: Starší')
    expect(historyText(agreed, 3)).toBe('domluveno za 8 b · rezervace: ty')
  })

  it('the old offer action reads as an offer', () => {
    expect(historyText(entry({ action: 'task.score_offered' }), 9)).toBe('nabídka 8 b')
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

describe('historyText: descriptions (#207)', () => {
  it.each([
    ['task.description_changed', 'nový popis'],
    ['task.description_change_proposed', 'návrh nového popisu'],
    ['task.description_change_approved', 'souhlas s novým popisem'],
    ['task.description_change_declined', 'nesouhlas s novým popisem'],
    ['task.description_change_withdrawn', 'návrh popisu stažen'],
  ] as const)('%s → "%s"', (action, text) => {
    expect(historyText(entry({ action, score: null }), 9)).toBe(text)
  })

  it('a discarded change by nobody has no name', () => {
    const e = entry({ action: 'task.description_change_discarded', by: null, score: null })
    expect(historyText(e, 9)).toBe('návrh popisu propadl')
  })
})

describe('historyItems (#248)', () => {
  const by = (id: number, name: string) => ({ by: { id, name } })
  const shape = (items: ReturnType<typeof historyItems>) =>
    items.map((i) =>
      i.kind === 'bubble'
        ? { id: i.id, side: i.side, name: i.name, above: i.joinAbove, below: i.joinBelow }
        : i.kind === 'note'
          ? { note: i.id }
          : { round: i.round },
    )

  it('mine left (no name), theirs right with a name, the system as a note', () => {
    const items = historyItems(
      [
        entry({ id: 1, ...by(2, 'Táta') }),
        entry({ id: 2, action: 'task.bid_placed', score: 12, ...by(4, 'Mladší') }),
        entry({ id: 3, action: 'instance.expired', by: null }),
      ],
      4,
    )
    // Newest on top (Jakub 2026-11-26 20:01).
    expect(items).toEqual([
      { kind: 'note', id: 3, text: 'prošlo', reason: null, time: 'so 21. 11. 10:12' },
      {
        kind: 'bubble',
        id: 2,
        side: 'mine',
        name: null,
        text: 'chce 12 b',
        reason: null,
        time: 'so 21. 11. 10:12',
        joinAbove: false,
        joinBelow: false,
      },
      {
        kind: 'bubble',
        id: 1,
        side: 'theirs',
        name: 'Táta',
        text: 'nový úkol za 8 b',
        reason: null,
        time: 'so 21. 11. 10:12',
        joinAbove: false,
        joinBelow: false,
      },
    ])
  })

  it('a run: same person in a row joins, the name only on the first', () => {
    const items = historyItems(
      [
        entry({ id: 1, ...by(2, 'Táta') }),
        entry({ id: 2, action: 'task.bid_accepted', ...by(2, 'Táta') }),
        entry({ id: 3, action: 'task.agreed', ...by(2, 'Táta') }),
      ],
      4,
    )
    expect(shape(items)).toEqual([
      { id: 3, side: 'theirs', name: 'Táta', above: false, below: true },
      { id: 2, side: 'theirs', name: null, above: true, below: true },
      { id: 1, side: 'theirs', name: null, above: true, below: false },
    ])
    // My own run joins the same way, with no name.
    expect(shape(historyItems([entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3 })], 2))).toEqual([
      { id: 3, side: 'mine', name: null, above: false, below: true },
      { id: 2, side: 'mine', name: null, above: true, below: true },
      { id: 1, side: 'mine', name: null, above: true, below: false },
    ])
  })

  it('a different person, a note or a round divider ends a run', () => {
    const tata = (id: number, action: HistoryEntry['action'] = 'task.bid_placed') =>
      entry({ id, action, ...by(2, 'Táta') })
    expect(
      shape(historyItems([tata(1), entry({ id: 2, ...by(6, 'Kristýna-Magdaléna') }), tata(3)], 4)),
    ).toEqual([
      { id: 3, side: 'theirs', name: 'Táta', above: false, below: false },
      { id: 2, side: 'theirs', name: 'Kristýna-Magdaléna', above: false, below: false },
      { id: 1, side: 'theirs', name: 'Táta', above: false, below: false },
    ])
    expect(
      shape(
        historyItems([tata(1), entry({ id: 2, action: 'instance.expired', by: null }), tata(3)], 4),
      ),
    ).toEqual([
      { id: 3, side: 'theirs', name: 'Táta', above: false, below: false },
      { note: 2 },
      { id: 1, side: 'theirs', name: 'Táta', above: false, below: false },
    ])
    expect(shape(historyItems([tata(1), tata(2, 'task.bidding_reopened')], 4))).toEqual([
      { round: 2 },
      { id: 2, side: 'theirs', name: 'Táta', above: false, below: false },
      { round: 1 },
      { id: 1, side: 'theirs', name: 'Táta', above: false, below: false },
    ])
  })

  it('mine is by id, not by name', () => {
    const items = historyItems(
      [entry({ id: 1, ...by(2, 'Táta') }), entry({ id: 2, ...by(5, 'Táta') })],
      5,
    )
    expect(shape(items)).toEqual([
      { id: 2, side: 'mine', name: null, above: false, below: false },
      { id: 1, side: 'theirs', name: 'Táta', above: false, below: false },
    ])
  })

  it('rounds: newest round on top, each under its divider, newest entry first; only once reopened', () => {
    const entries = [
      entry({ id: 1 }),
      entry({ id: 2, action: 'task.bid_placed', ...by(3, 'Starší') }),
      entry({ id: 3, action: 'task.bidding_reopened' }),
      entry({ id: 4, action: 'task.bid_placed', ...by(3, 'Starší') }),
    ]
    const items = historyItems(entries, 3)
    expect(
      items.map((i) => (i.kind === 'round' ? `${i.key}:${String(i.round)}` : `id${String(i.id)}`)),
    ).toEqual(['round-2:2', 'id4', 'id3', 'round-1:1', 'id2', 'id1'])
    expect(historyItems(entries.slice(0, 2), 3).map((i) => i.kind !== 'round' && i.id)).toEqual([
      2, 1,
    ])
    expect(historyItems([], 3)).toEqual([])
  })

  it('a reason stays with its entry', () => {
    const [item] = historyItems(
      [entry({ id: 1, action: 'task.rejected', reason: 'Pod postelí to pořád je.' })],
      3,
    )
    expect(item).toMatchObject({
      kind: 'bubble',
      text: 'vráceno',
      reason: '„Pod postelí to pořád je.“',
    })
    const [note] = historyItems([entry({ id: 1, by: null, reason: 'Zrušeno systémem.' })], 3)
    expect(note).toMatchObject({ kind: 'note', reason: '„Zrušeno systémem.“' })
  })
})

describe('threadItems (#289)', () => {
  const row = (over: Partial<ThreadEntry>): ThreadEntry => ({
    id: 1,
    side: 'taker',
    by: { id: 4, name: 'Starší' },
    score: 8,
    at: AT,
    state: 'open',
    ...over,
  })

  it('newest on top; mine left with no name, theirs right with a name; the history wording', () => {
    const items = threadItems(
      [
        row({ id: 1, side: 'giver', by: { id: 2, name: 'Táta' }, score: 6, state: 'replaced' }),
        row({ id: 2, score: 9 }),
      ],
      4,
    )
    expect(items).toEqual([
      {
        kind: 'bubble',
        id: 2,
        side: 'mine',
        name: null,
        text: 'chce 9 b',
        reason: null,
        time: 'so 21. 11. 10:12',
        joinAbove: false,
        joinBelow: false,
      },
      {
        kind: 'bubble',
        id: 1,
        side: 'theirs',
        name: 'Táta',
        text: 'nabídka 6 b',
        reason: 'změněno',
        time: 'so 21. 11. 10:12',
        joinAbove: false,
        joinBelow: false,
      },
    ])
  })

  it('a closed or accepted row carries its state word; an open one none', () => {
    const items = threadItems(
      [row({ id: 1, state: 'closed' }), row({ id: 2, state: 'accepted' }), row({ id: 3 })],
      2,
    )
    expect(items.map((i) => (i.kind === 'bubble' ? i.reason : '?'))).toEqual([
      null,
      'přijato',
      'uzavřeno',
    ])
  })

  it('a run: the same person in a row joins, the name only on the first; another person ends it', () => {
    const items = threadItems(
      [row({ id: 1, by: { id: 5, name: 'Mladší' } }), row({ id: 2 }), row({ id: 3 })],
      2,
    )
    expect(
      items.map((i) => (i.kind === 'bubble' ? [i.name, i.joinAbove, i.joinBelow] : null)),
    ).toEqual([
      ['Starší', false, true],
      [null, true, false],
      ['Mladší', false, false],
    ])
  })

  it('mine is by id, not by name', () => {
    const [item] = threadItems([row({ by: { id: 7, name: 'Starší' } })], 4)
    expect(item).toMatchObject({ side: 'theirs', name: 'Starší' })
  })
})
