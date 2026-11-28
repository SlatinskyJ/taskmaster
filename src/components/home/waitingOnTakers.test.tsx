import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { WaitingOnTakers } from './WaitingOnTakers'

// "Čeká na děti" on a parent's Domů (#41). A plain <a> with the real path stands in for Link.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
    className?: string
  }) => (
    <a href={to.replace(/\$(\w+)/, (_, k: string) => params?.[k] ?? '')} className={className}>
      {children}
    </a>
  ),
}))

const TATA = { id: 2, role: 'giver' } as const
const sklep = {
  id: 17,
  title: 'Uklidit sklep',
  status: 'proposed',
  score: 10,
  bids: [],
  lowest: null,
  waitingFor: [
    { id: 3, name: 'Starší' },
    { id: 4, name: 'Mladší' },
  ],
} as unknown as TaskView

describe('WaitingOnTakers (GHome, #41)', () => {
  it('lists each offer with who it waits for and a 44 px link to its page', () => {
    const html = renderToStaticMarkup(<WaitingOnTakers items={[sklep]} me={TATA} />)
    expect(html).toContain(`${cs.home.waitingOnTakers} (1)`)
    expect(html).toContain('Uklidit sklep')
    expect(html).toContain('Čeká se na: Starší nebo Mladší')
    const link = /<a href="([^"]*)" class="([^"]*)">([^<]*)<\/a>/.exec(html)
    expect(link?.[1]).toBe('/ukol/17')
    expect(link?.[3]).toBe(cs.bids.open)
    expect(link?.[2]).toContain('min-h-tap')
    expect(link?.[2]).toContain('border-track') // ghost, like the other row links
  })

  it('renders nothing when no offer waits for the boys', () => {
    expect(renderToStaticMarkup(<WaitingOnTakers items={[]} me={TATA} />)).toBe('')
  })
})
