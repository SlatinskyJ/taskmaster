import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { historyBack, Screen } from './Screen'

// The back arrow (#205): a fixed path stays that path; `history` (a task or chore page) goes back
// where the person came from in the app, else the link's own Domů.
const nav = vi.hoisted(() => ({ history: { canGoBack: () => true, back: () => undefined } }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: nav.history }),
  Link: ({
    to,
    children,
    'aria-label': label,
  }: {
    to: string
    children: ReactNode
    'aria-label'?: string
  }) => (
    <a href={to} aria-label={label}>
      {children}
    </a>
  ),
}))

const USER = { id: 3, displayName: 'Starší' }
const backHref = (back: Parameters<typeof Screen>[0]['back']) =>
  /<a href="([^"]*)" aria-label="([^"]*)"/.exec(
    renderToStaticMarkup(
      <Screen title="T" user={USER} back={back}>
        x
      </Screen>,
    ),
  )

describe('Screen back arrow', () => {
  it('a fixed path links to that path', () => {
    expect(backHref('/ukoly')?.slice(1)).toEqual(['/ukoly', cs.profile.back])
    expect(backHref('/tyden')?.slice(1)).toEqual(['/tyden', cs.profile.back])
  })

  it('history: links to Domů (the fallback); no back: no arrow', () => {
    expect(backHref('history')?.slice(1)).toEqual(['/', cs.profile.back])
    expect(backHref(undefined)?.[2]).not.toBe(cs.profile.back)
  })
})

describe('historyBack', () => {
  it('with in-app history: goes back and stops the link', () => {
    const history = { canGoBack: () => true, back: vi.fn() }
    const e = { preventDefault: vi.fn() }
    historyBack(history)(e)
    expect(history.back).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('opened cold: the link goes to Domů', () => {
    const history = { canGoBack: () => false, back: vi.fn() }
    const e = { preventDefault: vi.fn() }
    historyBack(history)(e)
    expect(history.back).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
