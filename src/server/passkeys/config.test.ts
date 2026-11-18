import { describe, expect, it } from 'vitest'
import { describePasskeys, passkeyConfig, PasskeyConfigError } from './config'

const RP = 'taskmaster.slatinsky.cz'

describe('passkeyConfig (spec §11 Passkeys: RP ID from config)', () => {
  it('is off when WEBAUTHN_RP_ID is unset or empty', () => {
    expect(passkeyConfig({})).toBeNull()
    expect(passkeyConfig({ WEBAUTHN_RP_ID: '' })).toBeNull()
  })

  it('defaults the origin to https://<rp id>', () => {
    expect(passkeyConfig({ WEBAUTHN_RP_ID: RP })).toEqual({
      rpId: RP,
      rpName: 'Taskmaster',
      origin: `https://${RP}`,
    })
  })

  it('keeps a port given in WEBAUTHN_ORIGIN', () => {
    expect(
      passkeyConfig({
        WEBAUTHN_RP_ID: 'pc.example.ts.net',
        WEBAUTHN_ORIGIN: 'https://pc.example.ts.net:8443',
      })?.origin,
    ).toBe('https://pc.example.ts.net:8443')
  })

  it('allows http only for localhost', () => {
    expect(
      passkeyConfig({ WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGIN: 'http://localhost:3000' })
        ?.origin,
    ).toBe('http://localhost:3000')
  })

  it('drops a trailing slash from the origin', () => {
    expect(passkeyConfig({ WEBAUTHN_RP_ID: RP, WEBAUTHN_ORIGIN: `https://${RP}/` })?.origin).toBe(
      `https://${RP}`,
    )
  })

  it.each([`https://${RP}`, `${RP}:443`, `${RP}/`, 'Taskmaster.slatinsky.cz'])(
    'refuses the RP ID %s',
    (rpId) => {
      expect(() => passkeyConfig({ WEBAUTHN_RP_ID: rpId })).toThrow(PasskeyConfigError)
    },
  )

  it.each([
    `http://${RP}`,
    'https://evil.cz',
    `https://x${RP}`,
    `https://${RP}/app`,
    `https://${RP}/?x=1`,
    `https://${RP}/#a`,
    'not a url',
  ])('refuses the origin %s', (origin) => {
    expect(() => passkeyConfig({ WEBAUTHN_RP_ID: RP, WEBAUTHN_ORIGIN: origin })).toThrow(
      PasskeyConfigError,
    )
  })

  it('accepts an origin on a subdomain of the RP ID', () => {
    expect(
      passkeyConfig({ WEBAUTHN_RP_ID: 'slatinsky.cz', WEBAUTHN_ORIGIN: `https://${RP}` })?.origin,
    ).toBe(`https://${RP}`)
  })
})

describe('describePasskeys (boot line)', () => {
  it('says off without config', () => {
    expect(describePasskeys(null)).toContain('off')
  })

  it('names the RP ID and origin when on', () => {
    const line = describePasskeys({ rpId: RP, rpName: 'Taskmaster', origin: `https://${RP}` })
    expect(line).toContain(RP)
    expect(line).toContain(`https://${RP}`)
  })
})
