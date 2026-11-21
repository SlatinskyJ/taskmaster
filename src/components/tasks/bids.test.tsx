import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TASK_SCORE_MAX } from '~/lib/taskLimits'
import { BidThread } from './BidThread'
import { ScoreStepper } from './ScoreStepper'

// The small bidding pieces (#34), rendered statically.

describe('bidding pieces', () => {
  it('BidThread: who, verb, number, time; my own entries say "Ty"; closed entries carry their state word', () => {
    const at = '2026-11-21T09:12:00.000Z'
    const html = renderToStaticMarkup(
      <BidThread
        me={3}
        entries={[
          { id: 1, side: 'giver', by: { id: 2, name: 'Táta' }, score: 18, at, state: 'open' },
          { id: 2, side: 'taker', by: { id: 3, name: 'Starší' }, score: 25, at, state: 'replaced' },
          { id: 3, side: 'taker', by: { id: 3, name: 'Starší' }, score: 23, at, state: 'open' },
        ]}
      />,
    )
    expect(html).toMatch(/Táta nabízí.*18.*so 10:12.*Ty chceš.*25.*změněno.*Ty chceš.*23/s)
    expect(html).not.toContain('Starší')
    expect(html.match(/změněno|přijato|uzavřeno/g)).toEqual(['změněno'])
    const other = renderToStaticMarkup(
      <BidThread
        me={2}
        entries={[
          { id: 1, side: 'giver', by: { id: 2, name: 'Táta' }, score: 18, at, state: 'open' },
          { id: 4, side: 'taker', by: { id: 4, name: 'Mladší' }, score: 22, at, state: 'accepted' },
        ]}
      />,
    )
    expect(other).toMatch(/Ty nabízíš.*18.*Mladší chce.*22.*přijato/s)
    expect(other).not.toContain('Táta')
  })
  it('ScoreStepper: each button is disabled exactly at its end', () => {
    const ends = (value: number) =>
      renderToStaticMarkup(<ScoreStepper value={value} onChange={() => undefined} label="Body" />)
        .split('role="slider"')
        .map((part) => part.includes('disabled=""'))
    expect([1, 2, TASK_SCORE_MAX - 1, TASK_SCORE_MAX].map(ends)).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ])
  })
})
