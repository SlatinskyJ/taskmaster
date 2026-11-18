import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { PersonForm } from './PersonForm'

const TATA = { id: 2, username: 'tata', displayName: 'Táta', role: 'giver', active: true } as const
const ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  role: 'admin',
  active: true,
} as const
const noop = () => Promise.resolve(null)

describe('PersonForm (Správa, #134)', () => {
  it('own row: no role select, no reset, self hint shown', () => {
    const html = renderToStaticMarkup(
      <PersonForm mode="edit" person={ADMIN} isSelf onSubmit={noop} onReset={() => undefined} />,
    )
    expect(html).toContain(cs.admin.selfHint)
    expect(html).not.toContain(cs.admin.reset)
    expect(html).not.toContain(`>${cs.admin.role}<`)
  })

  it('someone else: role select and reset shown', () => {
    const html = renderToStaticMarkup(
      <PersonForm mode="edit" person={TATA} onSubmit={noop} onReset={() => undefined} />,
    )
    expect(html).toContain(cs.admin.reset)
    expect(html).toContain(`>${cs.admin.role}<`)
    expect(html).not.toContain(cs.admin.selfHint)
  })

  it('add form password and login inputs keep the keyboard off', () => {
    const html = renderToStaticMarkup(<PersonForm mode="add" onSubmit={noop} />)
    for (const name of ['username', 'password']) {
      const input = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? ''
      expect(input).toMatch(/autocapitalize="none"/i)
      expect(input).toMatch(/autocorrect="off"/i)
      expect(input).toMatch(/spellcheck="false"/i)
    }
  })
})
