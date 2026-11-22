import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { cs } from '~/lib/strings'
import { defaultsProposal, periodProposal, proposalsView } from './fixtures'
import { defaultsNowLine, defaultsRows, periodRows } from './proposalRows'

// Every value a proposal card lists, old → new, pinned whole so none can drop out.

const t = cs.proposals

describe('proposal rows', () => {
  it('next week: end, length, both levels, against the server defaultNext', () => {
    const v = proposalsView()
    if (!v.defaultNext) throw new Error('defaultNext')
    expect(periodRows(periodProposal(), v.defaultNext)).toEqual([
      { label: t.end, old: 'ne 6. 12. 23:59', now: 'so 5. 12. 20:00' },
      { label: t.length, old: '7 dní', now: '6 dní' },
      { label: t.lower, old: '50', now: '60' },
      { label: t.upper, old: '100', now: '120' },
    ])
  })

  it('default week: length, end weekday and time, both levels, against the stored one', () => {
    const d = defaultsProposal({
      settings: {
        lengthDays: 14,
        cutoff: { weekday: 6, hour: 8, minute: 5 },
        levels: { lower: 60, upper: 120 },
      },
    })
    expect(defaultsRows(d, DEFAULT_PERIOD_DEFAULTS)).toEqual([
      { label: t.length, old: '7 dní', now: '14 dní' },
      { label: t.end, old: 'neděle 23:59', now: 'sobota 08:05' },
      { label: t.lower, old: '50', now: '60' },
      { label: t.upper, old: '100', now: '120' },
    ])
  })

  it('the Nyní line over the Výchozí týden form', () => {
    expect(defaultsNowLine(DEFAULT_PERIOD_DEFAULTS)).toBe(
      'Nyní: 7 dní · konec neděle 23:59 · spodní hranice 50, horní 100',
    )
  })
})
