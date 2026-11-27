import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { AdminPasskeys } from './AdminPasskeys'
import { PasskeyList } from './PasskeyList'
import { PasskeyLoginButton } from './PasskeyLoginButton'
import { ProfilePassword } from './ProfilePassword'

describe('PasskeyLoginButton', () => {
  it('shows the Czech label and the first-login hint', () => {
    const html = renderToStaticMarkup(
      <PasskeyLoginButton busy={false} error={null} onClick={() => undefined} />,
    )
    expect(html).toContain(cs.passkeys.loginButton)
    expect(html).toContain(cs.passkeys.hint)
    expect(html).not.toMatch(/<button[^>]*disabled=/)
  })

  it('shows its own error under the button in place of the hint', () => {
    const html = renderToStaticMarkup(
      <PasskeyLoginButton busy={false} error={cs.passkeys.unknown} onClick={() => undefined} />,
    )
    expect(html).toContain(`role="alert"`)
    expect(html).toContain(cs.passkeys.unknown)
    expect(html).not.toContain(cs.passkeys.hint)
  })

  it('is disabled while its ceremony runs', () => {
    const html = renderToStaticMarkup(
      <PasskeyLoginButton busy error={null} onClick={() => undefined} />,
    )
    expect(html).toMatch(/<button[^>]*disabled=/)
  })
})

describe('PasskeyList', () => {
  const ITEMS = [
    {
      id: 7,
      deviceKind: 'iphone' as const,
      createdAt: '2026-11-17T23:30:00.000Z',
      lastUsedAt: null,
      backedUp: true,
    },
    {
      id: 3,
      deviceKind: 'other' as const,
      createdAt: '2026-06-30T22:30:00.000Z',
      lastUsedAt: '2026-11-17T22:59:59.000Z',
      backedUp: false,
    },
  ]

  it('renders device label, Prague dates and a remove button per item', () => {
    const html = renderToStaticMarkup(
      <PasskeyList items={ITEMS} hereId={null} busyId={null} onRemove={() => undefined} />,
    )
    expect(html).toContain('iPhone')
    expect(html).toContain(cs.passkeys.device.other)
    expect(html).toContain(cs.passkeys.addedOn('18. 11. 2026'))
    expect(html).toContain(cs.passkeys.neverUsed)
    expect(html).toContain(cs.passkeys.addedOn('1. 7. 2026'))
    expect(html).toContain(cs.passkeys.lastUsed('17. 11. 2026'))
    expect(html.match(new RegExp(`>${cs.passkeys.remove}<`, 'g'))).toHaveLength(2)
    expect(html).not.toContain(cs.passkeys.thisDevice)
  })

  it('marks only the passkey this browser added', () => {
    const html = renderToStaticMarkup(
      <PasskeyList items={ITEMS} hereId={3} busyId={null} onRemove={() => undefined} />,
    )
    expect(html.match(new RegExp(cs.passkeys.thisDevice, 'g'))).toHaveLength(1)
    expect(html.indexOf(cs.passkeys.thisDevice)).toBeGreaterThan(
      html.indexOf(cs.passkeys.device.other),
    )
  })

  it('an empty list says so', () => {
    const html = renderToStaticMarkup(
      <PasskeyList items={[]} hereId={null} busyId={null} onRemove={() => undefined} />,
    )
    expect(html).toContain(cs.passkeys.empty)
  })
})

describe('AdminPasskeys', () => {
  it('renders nothing for a person without passkeys', () => {
    const html = renderToStaticMarkup(
      <AdminPasskeys count={0} busy={false} onRemove={() => undefined} />,
    )
    expect(html).toBe('')
  })

  it('shows the count and the remove button', () => {
    const html = renderToStaticMarkup(
      <AdminPasskeys count={3} busy={false} onRemove={() => undefined} />,
    )
    expect(html).toContain('3 klíče')
    expect(html).toContain(cs.passkeys.admin.removeAll)
  })
})

// Profil → Heslo on the public demo (#328): the row stays, disabled, with the lock note.
describe('ProfilePassword', () => {
  const row = (html: string) =>
    new RegExp(`<button[^>]*>${cs.profile.passwordRow}`).exec(html)?.[0] ?? ''

  it('locked: the row is disabled and the note shown', () => {
    const html = renderToStaticMarkup(<ProfilePassword enabled locked username="starsi" />)
    expect(row(html)).toContain('disabled=""')
    expect(html).toContain(cs.demo.lockedNote)
  })

  it('unlocked: the row works, no note', () => {
    const html = renderToStaticMarkup(<ProfilePassword enabled username="starsi" />)
    expect(row(html)).not.toBe('')
    expect(row(html)).not.toContain('disabled=""')
    expect(html).not.toContain(cs.demo.lockedNote)
  })

  it('switch off: nothing, locked or not', () => {
    expect(renderToStaticMarkup(<ProfilePassword enabled={false} username="starsi" />)).toBe('')
    expect(renderToStaticMarkup(<ProfilePassword enabled={false} locked username="starsi" />)).toBe(
      '',
    )
  })
})
