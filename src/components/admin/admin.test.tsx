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

  it('Return key hints: next on name and login, done on the password (#286)', () => {
    const add = renderToStaticMarkup(<PersonForm mode="add" onSubmit={noop} />)
    const hint = (html: string, name: string) =>
      /enterkeyhint="(\w+)"/i.exec(
        new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? '',
      )?.[1]
    expect(hint(add, 'displayName')).toBe('next')
    expect(hint(add, 'username')).toBe('next')
    expect(hint(add, 'password')).toBe('done')
    const edit = renderToStaticMarkup(
      <PersonForm mode="edit" person={TATA} onSubmit={noop} onReset={() => undefined} />,
    )
    expect(hint(edit, 'displayName')).toBe('done')
  })

  it('fields and Uložit share one scroll body, Uložit after the last field (#159)', () => {
    const html = renderToStaticMarkup(<PersonForm mode="add" onSubmit={noop} />)
    expect(html).not.toContain('data-slot="drawer-footer"')
    const body = html.indexOf('data-slot="person-form-body"')
    expect(body).toBeGreaterThan(-1)
    const save = html.indexOf(`>${cs.admin.save}</button>`)
    expect(save).toBeGreaterThan(html.indexOf('name="password"'))
    // Exactly one scroll container, and the button sits inside it.
    expect(html.match(/overflow-y-auto/g)).toHaveLength(1)
    expect(html.indexOf('overflow-y-auto')).toBeLessThan(html.indexOf('name="displayName"'))
    expect(html.slice(save)).toMatch(/^[^]*<\/div><\/form>$/)
  })
})

// The public demo (#328): people are locked; the sheet still opens, every control in it is
// disabled through one fieldset, with the lock note at its top.
describe('PersonForm locked on the demo', () => {
  for (const mode of ['edit', 'add'] as const) {
    it(`${mode}: one disabled fieldset with the lock note`, () => {
      const html = renderToStaticMarkup(
        <PersonForm
          mode={mode}
          person={mode === 'edit' ? TATA : undefined}
          locked
          onSubmit={noop}
          onReset={() => undefined}
        />,
      )
      expect(html).toContain('<fieldset disabled=""')
      expect(html).toContain(cs.demo.lockedNote)
      expect(html.indexOf(cs.demo.lockedNote)).toBeLessThan(html.indexOf('name="displayName"'))
    })
  }

  it('unlocked: no disabled fieldset, no note', () => {
    const html = renderToStaticMarkup(
      <PersonForm mode="edit" person={TATA} onSubmit={noop} onReset={() => undefined} />,
    )
    expect(html).not.toContain('<fieldset disabled')
    expect(html).not.toContain(cs.demo.lockedNote)
  })
})
