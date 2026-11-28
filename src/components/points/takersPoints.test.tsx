import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PointsOverview } from '~/server/points/functions'
import { TakersPoints } from './TakersPoints'

// The giver's "Děti tento týden" card (#41). PointsBar records its props; the card must pass
// each taker's own numbers and the period's levels, quiet (no celebrations on a giver's screen).
const bars = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('./PointsBar', () => ({
  PointsBar: (props: Record<string, unknown>) => {
    bars.props.push(props)
    return <div data-slot="points-bar" />
  },
}))

const overview = (takers: PointsOverview['takers']): PointsOverview => ({
  levels: { lower: 40, upper: 90 },
  takers,
})

describe('TakersPoints (GHome, spec §5.7)', () => {
  it('shows every taker in order with his own quiet bar against the levels', () => {
    bars.props = []
    const html = renderToStaticMarkup(
      <TakersPoints
        points={overview([
          { id: 3, name: 'Starší', confirmed: 40, pending: 12 },
          { id: 4, name: 'Mladší', confirmed: 55, pending: 0 },
        ])}
      />,
    )
    expect(html).toContain('Děti tento týden')
    expect(html.indexOf('Starší')).toBeLessThan(html.indexOf('Mladší'))
    expect(bars.props).toEqual([
      { confirmed: 40, pending: 12, lower: 40, upper: 90, celebrate: false, subject: '3' },
      { confirmed: 55, pending: 0, lower: 40, upper: 90, celebrate: false, subject: '4' },
    ])
  })

  it('renders nothing without takers', () => {
    expect(renderToStaticMarkup(<TakersPoints points={overview([])} />)).toBe('')
  })
})
