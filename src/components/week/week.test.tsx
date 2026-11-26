import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DisputeListEntry } from '~/server/disputes/functions'
import { cs } from '~/lib/strings'
import { takerWeek, week } from './fixtures'
import { PlanCard, rejectionLine, WeekBody, WeekScreen } from './WeekScreen'
import type { WeekTab } from './WeekScreen'

// Týden (#45): every state of both tabs, rendered statically.

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children, className }: { to?: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('~/server/disputes/functions', () => ({ openDisputeFn: vi.fn() }))

const html = (w = week(), tab: WeekTab = 'this', role: 'taker' | 'giver' = 'giver') =>
  renderToStaticMarkup(<WeekBody week={w} tab={tab} viewerRole={role} />)

describe('Tento týden', () => {
  it('a taker: his one card, no name heading', () => {
    const out = html(takerWeek(), 'this', 'taker')
    expect(out.match(/data-taker=/g)).toHaveLength(1)
    expect(out).not.toContain('>Starší<')
    expect(out).not.toContain('Mladší')
  })

  it('a giver: a named card per taker', () => {
    const out = html()
    expect(out).toContain('>Starší</p>')
    expect(out).toContain('>Mladší</p>')
  })

  it('confirmed and pending each in their own colour (a swap fails)', () => {
    const out = html(takerWeek(), 'this', 'taker')
    expect(out).toMatch(/<span class="text-state-confirmed-text">112(<!-- -->)? ✔<\/span>/)
    expect(out).toMatch(/<span class="text-state-pending-text">2(<!-- -->)? ⏳<\/span>/)
  })

  it('the week range and carried-in points; the levels only on the bar', () => {
    const out = html(takerWeek(), 'this', 'taker')
    expect(out).toContain('21. 11. – 29. 11.')
    expect(out).toContain('Z minula převedeno 8 bodů</p>')
    expect(out).toMatch(/spodní(<!-- -->)? (<!-- -->)?50/)
    expect(out).not.toContain('spodní 50 · horní 100')
  })

  it('last week not settled yet: its points on their own line; none once settled', () => {
    const w = takerWeek()
    const [t] = w.takers
    if (!t) throw new Error('no taker')
    const late = { ...w, takers: [{ ...t, unsettled: 36 }] }
    expect(html(late, 'this', 'taker')).toContain('Z minulého týdne čeká na poradu: 36 bodů</p>')
    expect(html(w, 'this', 'taker')).not.toContain('Z minulého týdne')
  })

  it('items: state chips, the day, a rejection with its reason', () => {
    const out = html(takerWeek(), 'this', 'taker')
    expect(out).toContain(cs.week.happened)
    expect(out).toContain('Vyluxovat celý obývák a chodbu')
    expect(out).toContain(cs.state.confirmed)
    expect(out).toContain(cs.state.pending)
    expect(out).toContain(cs.state.rejected)
    expect(out).toContain('nádobí zůstalo v dřezu Vráceno tobě.')
    expect(out).toContain('út 24. 11.')
  })

  it('a giver reads whom a rejected chore went back to', () => {
    expect(html()).toContain('nádobí zůstalo v dřezu Vráceno: Starší.')
  })

  it('no items yet', () => {
    const out = html(week(), 'this', 'giver')
    expect(out).toContain(cs.week.noItems)
  })

  it('no period: the no-period line, numbers still shown, no items section', () => {
    const out = html({ ...takerWeek(), period: null }, 'this', 'taker')
    expect(out).toContain(cs.week.noPeriod)
    expect(out).toMatch(/<span class="text-state-confirmed-text">112(<!-- -->)? ✔<\/span>/)
    expect(out).toContain('Z minula převedeno 8 bodů')
    expect(out).not.toContain(cs.week.happened)
    expect(out).toContain('aria-label="112 potvrzeno + 2 čeká"')
  })
})

describe('Historie', () => {
  it('a card per settled week with level badge and the numbers', () => {
    const out = html(week(), 'history')
    expect(out).toContain('14. 11. – 21. 11.')
    expect(out).toContain('Celkem 108 · odečteno 100 · převod 8')
    expect(out).toContain('Celkem 50 · odečteno 50 · převod 0')
    expect(out).toContain(cs.meeting.level.upper)
    expect(out).toContain(cs.meeting.level.lower)
    expect(out).toContain('>Mladší</span>')
  })

  it('a taker sees no names', () => {
    const out = html(takerWeek(), 'history', 'taker')
    expect(out).toContain('Celkem 108')
    expect(out).not.toContain('Starší')
  })

  it('nothing settled yet', () => {
    expect(html(week({ history: [] }), 'history')).toContain(cs.week.noHistory)
  })
})

describe('adjustments and corrections (#48)', () => {
  const longReason = 'Pomohl s velkým nákupem a odnesl všechny tašky až do třetího patra. '.repeat(
    14,
  )
  const manual = {
    id: 31,
    points: 5,
    reason: longReason,
    at: '2026-11-25T10:00:00.000Z',
    fromWeek: null,
    waiting: false,
    dispute: { item: { kind: 'adjustment' as const, id: 31 }, mark: null },
  }
  const fromWeek = { startsAt: '2026-11-14T19:00:00.000Z', endsAt: '2026-11-21T19:00:00.000Z' }
  const corrected = {
    ...manual,
    id: 32,
    points: -50,
    reason: 'Chyběl úkol.',
    fromWeek,
    dispute: null,
  }
  const waiting = { ...manual, id: 33, points: -3, reason: 'Hrnek.', waiting: true }
  const withAdjustments = (list: (typeof manual | typeof corrected)[]) => {
    const w = takerWeek()
    const [t] = w.takers
    if (!t) throw new Error('fixture')
    return { ...w, takers: [{ ...t, adjustments: list }] }
  }
  const body = (w: ReturnType<typeof takerWeek>, tab: WeekTab = 'this', disputes = true) =>
    renderToStaticMarkup(<WeekBody week={w} tab={tab} viewerRole="taker" disputes={disputes} />)

  it('a manual adjustment: its name, the whole reason, signed points, Rozporovat', () => {
    const out = body(withAdjustments([manual]))
    expect(out).toContain(cs.week.adjustment)
    expect(out).toContain(longReason.trim())
    expect(out).toContain('+5 b.')
    expect(out).toContain(
      `aria-label="${cs.disputes.actionFor(cs.disputes.what.adjustment, cs.week.adjustment)}"`,
    )
  })

  it('one from a correction: Oprava týdne with its week, no Rozporovat', () => {
    const out = body(withAdjustments([corrected]))
    expect(out).toContain(cs.week.correctionRow)
    expect(out).toContain(cs.week.fromWeek('14. 11. – 21. 11.'))
    expect(out).toContain('−50 b.')
    expect(out).not.toContain(
      cs.disputes.actionFor(cs.disputes.what.adjustment, cs.week.correctionRow),
    )
  })

  it('one from an ended, unsettled week says it waits for the meeting', () => {
    expect(body(withAdjustments([waiting]))).toContain(cs.week.waiting)
  })

  it('switch off: rows, but no Rozporovat', () => {
    const out = body(withAdjustments([manual]), 'this', false)
    expect(out).toContain(cs.week.adjustment)
    expect(out).not.toContain(cs.disputes.action)
  })

  it('Historie: a corrected record shows its corrected level, the settled numbers and the line', () => {
    const w = takerWeek()
    const h = w.history[0]
    const r = h?.records[0]
    if (!h || !r) throw new Error('fixture')
    const c = {
      ...r,
      correction: {
        level: 'none' as const,
        deducted: 0,
        reason: 'Chyběl úkol.',
        at: '2026-11-24T10:00:00.000Z',
      },
      adjustments: [corrected],
    }
    const out = body({ ...w, history: [{ ...h, records: [c] }] }, 'history')
    expect(out).toContain(`>${cs.meeting.level.none}<`)
    expect(out).toContain('Celkem 108 · odečteno 100 · převod 8')
    expect(out).toContain(
      cs.week.correctedLine('Bez kapesného', 'Horní hranice', 100, '24. 11.', 'Chyběl úkol.'),
    )
    expect(out).toContain(cs.week.correctionRow)
  })
})

describe('WeekScreen', () => {
  it('two tabs, this week open', () => {
    const out = renderToStaticMarkup(<WeekScreen week={week()} viewerRole="giver" />)
    expect(out).toContain(cs.week.thisWeek)
    expect(out).toContain(cs.week.history)
    expect(out).toContain('data-taker="3"')
  })
})

describe('rejectionLine', () => {
  const base = takerWeek().takers[0]?.items[2]
  if (!base) throw new Error('fixture')
  it('reason, then whom it went back to', () => {
    expect(rejectionLine(base, null)).toBe('nádobí zůstalo v dřezu Vráceno tobě.')
    expect(rejectionLine(base, 'Starší')).toBe('nádobí zůstalo v dřezu Vráceno: Starší.')
  })
  it('without a reason only the return', () => {
    expect(rejectionLine({ ...base, reason: null }, null)).toBe('Vráceno tobě.')
  })
  it('nothing for other items', () => {
    expect(rejectionLine({ ...base, status: 'confirmed' }, null)).toBeUndefined()
  })
  it('a rejected self-log did not go back: only the reason, or that it earned nothing', () => {
    expect(rejectionLine({ ...base, closed: true }, null)).toBe('nádobí zůstalo v dřezu')
    expect(rejectionLine({ ...base, closed: true, reason: null }, 'Mladší')).toBe('Bez bodů.')
  })
})

describe('Rozporovat on Týden (#46)', () => {
  const on = (w = week(), tab: WeekTab = 'this', list: DisputeListEntry[] = []) =>
    renderToStaticMarkup(
      <WeekBody week={w} tab={tab} viewerRole="giver" disputes disputeList={list} />,
    )
  const rows = (out: string) => out.split('data-slot="task-row"').slice(1)

  it('confirmed and rejected items have it inside their card; a waiting one not', () => {
    const [waiting, confirmed, rejected] = rows(on())
    expect(waiting).not.toContain('data-slot="dispute"')
    expect(confirmed).toContain('data-slot="dispute"')
    expect(rejected).toContain('data-slot="dispute"')
    expect(confirmed).toContain(
      'aria-label="Rozporovat: Potvrzené splnění – Vyluxovat celý obývák a chodbu"',
    )
    expect(rejected).toContain('aria-label="Rozporovat: Zamítnuté splnění – Vynést sklo"')
  })

  it('an open dispute: Sporné on the row, its own chip and points unchanged', () => {
    const w = week()
    const t = w.takers[0]
    const i = t?.items[1]
    if (!t || !i?.dispute) throw new Error('fixture')
    i.dispute.mark = { status: 'open' }
    const [, confirmed] = rows(on(w))
    expect(confirmed).toContain(cs.disputes.waiting)
    expect(confirmed).toContain(cs.state.confirmed)
    expect(confirmed).toMatch(/>8</)
    expect(confirmed).not.toContain(`>${cs.disputes.action}<`)
  })

  it('each history record has one, named by its week', () => {
    const out = on(week(), 'history')
    const records = out.split('data-record=').slice(1)
    expect(records).toHaveLength(2)
    for (const r of records) expect(r).toContain('data-slot="dispute"')
    expect(out).toContain('aria-label="Rozporovat: Vyúčtování týdne – 14. 11. – 21. 11."')
  })

  it('a closed dispute on a record shows its outcome and Rozporovat again', () => {
    const w = week()
    const r = w.history[0]?.records[1]
    if (!r) throw new Error('fixture')
    r.dispute = { status: 'dismissed', note: 'Body sedí.' }
    const out = on(w, 'history')
    expect(out).toContain('Správce nechal beze změny: Body sedí.')
    expect(out.split(`>${cs.disputes.action}<`)).toHaveLength(3)
  })

  it('Historie: Rozporováno above the weeks', () => {
    const entry: DisputeListEntry = {
      id: 1,
      item: { kind: 'settlement', id: 22 },
      title: '',
      week: { startsAt: '2026-11-14T19:00:00.000Z', endsAt: '2026-11-21T19:00:00.000Z' },
      takerName: 'Mladší',
      openedByName: 'Mladší',
      reason: 'Měl jsem víc.',
      openedAt: '2026-11-22T10:00:00.000Z',
      mark: { status: 'open' },
    }
    const out = on(week(), 'history', [entry])
    expect(out).toContain(cs.disputes.list)
    expect(out.indexOf(cs.disputes.list)).toBeLessThan(out.indexOf('data-period='))
  })

  it('switch off: nothing new anywhere', () => {
    const w = week()
    const i = w.takers[0]?.items[1]
    if (!i?.dispute) throw new Error('fixture')
    i.dispute.mark = { status: 'open' }
    for (const tab of ['this', 'history'] as const) {
      const out = html(w, tab)
      expect(out).not.toContain(cs.disputes.action)
      expect(out).not.toContain('data-slot="dispute"')
      expect(out).not.toContain(cs.disputes.list)
    }
  })
})

describe('Plán týdne card (#258)', () => {
  it('PlanCard has min-h-tap and the chevron, and links to /tyden/plan', () => {
    const out = renderToStaticMarkup(<PlanCard free={3} viewerRole="taker" />)
    expect(out).toMatch(/<a href="\/tyden\/plan" class="[^"]*min-h-tap/)
    expect(out).toContain('lucide-chevron-right')
    expect(out).toContain('Rozděl si úkoly na dny. Volných: 3')
    expect(renderToStaticMarkup(<PlanCard free={0} viewerRole="giver" />)).toContain(
      'Kdo co dělá který den. Volných: 0',
    )
  })
})
