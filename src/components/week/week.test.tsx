import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { takerWeek, week } from './fixtures'
import { rejectionLine, WeekBody, WeekScreen } from './WeekScreen'
import type { WeekTab } from './WeekScreen'

// Týden (#45): every state of both tabs, rendered statically.

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
})
