import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as BarModule from './PointsBar'
import { MyPoints, missingLine } from './MyPoints'

// The taker's points card on Domů (spec §5.7, mockup Main), rendered statically.
const bar = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('./PointsBar', async (original) => {
  const real = await original<typeof BarModule>()
  return {
    PointsBar: (props: Parameters<typeof real.PointsBar>[0]) => {
      bar.props.push(props)
      return real.PointsBar(props)
    },
  }
})

const levels = { lower: 50, upper: 100 }
beforeEach(() => {
  bar.props = []
})

describe('missingLine', () => {
  it.each([
    [0, 'Do spodní hranice chybí 50 bodů.'],
    [49, 'Do spodní hranice chybí 1 bod.'],
    [47, 'Do spodní hranice chybí 3 body.'],
    [50, 'Do horní hranice chybí 50 bodů.'],
    [99, 'Do horní hranice chybí 1 bod.'],
    [100, 'Horní hranice splněna!'],
    [130, 'Horní hranice splněna!'],
  ])('%i confirmed → %s', (confirmed, text) => {
    expect(missingLine(confirmed, levels)).toBe(text)
  })
})

describe('MyPoints', () => {
  const points = {
    levels: { lower: 40, upper: 90 },
    takers: [{ id: 5, name: 'Starší', confirmed: 18, pending: 4 }],
  }

  it('shows nothing when the list has no row for me', () => {
    expect(renderToStaticMarkup(<MyPoints points={points} me={6} />)).toBe('')
    expect(bar.props).toEqual([])
  })

  it('shows my bar against the levels it was given, with the still-missing line', () => {
    const html = renderToStaticMarkup(<MyPoints points={points} me={5} />)
    expect(html).toContain('spodní 40')
    expect(html).toContain('horní 90')
    expect(html).toContain('spodní hranice 40')
    expect(html).toContain('horní 90')
    expect(html).toContain('18 ✔')
    expect(html).toContain('4 ⏳')
    expect(html).toContain('Do spodní hranice chybí 22 bodů.')
    expect(html).toContain('data-slot="card"')
    expect(bar.props[0]).toMatchObject({
      confirmed: 18,
      pending: 4,
      lower: 40,
      upper: 90,
      celebrate: true,
      subject: '5',
    })
  })
})
