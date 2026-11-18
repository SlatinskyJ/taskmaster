import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { PasskeyLoginButton } from './PasskeyLoginButton'

describe('PasskeyLoginButton', () => {
  it('shows the Czech label and the first-login hint', () => {
    const html = renderToStaticMarkup(<PasskeyLoginButton busy={false} onClick={() => undefined} />)
    expect(html).toContain(cs.passkeys.loginButton)
    expect(html).toContain(cs.passkeys.hint)
    expect(html).not.toMatch(/<button[^>]*disabled=/)
  })

  it('is disabled while its ceremony runs', () => {
    const html = renderToStaticMarkup(<PasskeyLoginButton busy onClick={() => undefined} />)
    expect(html).toMatch(/<button[^>]*disabled=/)
  })
})
