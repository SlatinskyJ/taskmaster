import { describe, expect, it, vi } from 'vitest'
import { marker, withMarker } from '~/lib/liveSubs.testing'

// Zapsat's loader (#299): the tiles, the "Kdy?" choices and the live subscription. Lives here,
// not in src/routes, because the router generator treats every file there as a route.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  redirect: vi.fn(),
}))
vi.mock('~/server/instances/functions', () => ({
  listLoggableTemplatesFn: vi.fn(() =>
    Promise.resolve(withMarker('listLoggableTemplatesFn', { tiles: ['tile'], choices: ['now'] })),
  ),
  selfLogFn: vi.fn(),
}))

const { Route } = await import('~/routes/_app/zapsat')

describe('Zapsat loader', () => {
  it('returns the tiles, the choices and the live subscription', async () => {
    const loader = (Route as unknown as { loader: () => Promise<unknown> }).loader
    expect(await loader()).toEqual({
      tiles: ['tile'],
      choices: ['now'],
      live: [marker('listLoggableTemplatesFn')],
    })
  })
})
