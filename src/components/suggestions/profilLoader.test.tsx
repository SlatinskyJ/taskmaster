import { describe, expect, it, vi } from 'vitest'
import { marker, withMarker } from '~/lib/liveSubs.testing'

// Profil's loader (#299): passkeys issue no topics; one's own suggestions do. Lives here, not in
// src/routes, because the router generator treats every file there as a route.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  redirect: vi.fn(),
  Link: () => null,
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('~/server/passkeys/functions', () => ({
  getPasskeysEnabledFn: vi.fn(() => Promise.resolve(false)),
  listMyPasskeysFn: vi.fn(() => Promise.resolve([])),
}))
vi.mock('~/server/suggestions/functions', () => ({
  listMySuggestionsFn: vi.fn(() => Promise.resolve(withMarker('listMySuggestionsFn', []))),
}))
vi.mock('~/server/auth/functions', () => ({ logoutFn: vi.fn() }))

const { Route } = await import('~/routes/_app/profil')
const { listMySuggestionsFn } = await import('~/server/suggestions/functions')

describe('Profil loader', () => {
  const loader = (Route as unknown as { loader: () => Promise<unknown> }).loader

  it("returns one's own suggestions' live subscription, none for passkeys", async () => {
    expect(await loader()).toEqual({
      enabled: false,
      passkeys: [],
      suggestions: [],
      live: [marker('listMySuggestionsFn')],
    })
  })

  it('a failed suggestions load takes no subscription', async () => {
    vi.mocked(listMySuggestionsFn).mockRejectedValueOnce(new Error('net'))
    expect(await loader()).toMatchObject({ live: [] })
  })
})
