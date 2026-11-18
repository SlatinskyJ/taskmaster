import { describe, expect, it } from 'vitest'
import { CONFIG, family, IPHONE_UA, must, phone, T0 } from '../../../tests/support/passkeys'
import { startPasskeyLogin } from './login'
import {
  MAX_BODY_LENGTH,
  MAX_ID_LENGTH,
  parseAuthenticationResponse,
  parseId,
  parseRegistrationResponse,
} from './parse'
import { finishRegistration, startRegistration } from './register'

async function responses() {
  const { db, tata } = family()
  const device = phone()
  const { token, options } = must(await startRegistration(db, tata, CONFIG, T0))
  const registration = device.register(options)
  must(
    await finishRegistration(
      db,
      tata,
      { token, response: registration, userAgent: IPHONE_UA },
      CONFIG,
      T0,
    ),
  )
  const login = must(await startPasskeyLogin(db, '10.0.0.1', CONFIG, T0))
  return { registration, authentication: device.authenticate(login.options) }
}

describe('passkey response validators', () => {
  it('pass real responses through unchanged', async () => {
    const { registration, authentication } = await responses()
    expect(parseRegistrationResponse(registration)).toEqual(registration)
    expect(parseAuthenticationResponse(authentication)).toEqual(authentication)
  })

  it(`ids up to ${String(MAX_ID_LENGTH)} characters`, async () => {
    const { authentication } = await responses()
    const id = (n: number) => ({ ...authentication, id: 'A'.repeat(n), rawId: 'A'.repeat(n) })
    expect(() => parseAuthenticationResponse(id(MAX_ID_LENGTH))).not.toThrow()
    expect(() => parseAuthenticationResponse(id(MAX_ID_LENGTH + 1))).toThrow()
  })

  it(`bodies up to ${String(MAX_BODY_LENGTH)} characters`, async () => {
    const { authentication } = await responses()
    const size = JSON.stringify(authentication).length
    const padded = (total: number) => ({
      ...authentication,
      clientExtensionResults: { pad: 'x'.repeat(total - size - '"pad":""'.length) },
    })
    expect(JSON.stringify(padded(MAX_BODY_LENGTH - 1)).length).toBe(MAX_BODY_LENGTH - 1)
    expect(() => parseAuthenticationResponse(padded(MAX_BODY_LENGTH - 1))).not.toThrow()
    expect(() => parseAuthenticationResponse(padded(MAX_BODY_LENGTH + 1))).toThrow()
  })

  it('refuse malformed responses', async () => {
    const { registration, authentication } = await responses()
    const noId: Partial<typeof authentication> = { ...authentication }
    delete noId.id
    const bad: unknown[] = [
      null,
      'x',
      noId,
      { ...authentication, type: 'x' },
      { ...authentication, rawId: 'not base64url!' },
      { ...authentication, response: { ...authentication.response, clientDataJSON: 5 } },
      { ...authentication, response: { ...authentication.response, userHandle: 5 } },
      { ...authentication, response: null },
    ]
    for (const value of bad) expect(() => parseAuthenticationResponse(value)).toThrow()
    expect(() =>
      parseRegistrationResponse({
        ...registration,
        response: { ...registration.response, attestationObject: undefined },
      }),
    ).toThrow()
    expect(() =>
      parseRegistrationResponse({
        ...registration,
        response: { ...registration.response, transports: [1] },
      }),
    ).toThrow()
  })

  it('ids are positive safe integers', () => {
    expect(parseId({ passkeyId: 3 }, 'passkeyId')).toBe(3)
    for (const v of [0, -1, 1.5, '3', null, 2 ** 53]) {
      expect(() => parseId({ passkeyId: v }, 'passkeyId')).toThrow()
    }
    expect(() => parseId({ userId: 3 }, 'passkeyId')).toThrow()
  })
})
