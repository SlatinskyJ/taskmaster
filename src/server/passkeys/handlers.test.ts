import { createHash } from 'node:crypto'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '~/server/db'
import { passkeyChallenges, passkeys, sessions } from '~/server/db/schema'
import { MAX_LOGIN_CHALLENGES_PER_IP, MAX_REGISTER_CHALLENGES_PER_USER } from './challenges'
import { CONFIG, family, IPHONE_UA, phone } from '../../../tests/support/passkeys'
import type { Family } from '../../../tests/support/passkeys'

// The server-function bodies (./handlers), with the request faked: cookies, headers, IP, DB.
interface Cookie {
  name: string
  value: string
  opts: unknown
}
interface FakeRequest {
  cookies: Map<string, string>
  set: Cookie[]
  deleted: string[]
  headers: Record<string, string>
  ip: string
  db: Db | undefined
}
const req = vi.hoisted((): FakeRequest => ({
  cookies: new Map(),
  set: [],
  deleted: [],
  headers: {},
  ip: '10.0.0.2',
  db: undefined,
}))
vi.mock('@tanstack/react-start/server', () => ({
  getCookie: (name: string) => req.cookies.get(name),
  setCookie: (name: string, value: string, opts: unknown) => {
    req.set.push({ name, value, opts })
    req.cookies.set(name, value)
  },
  deleteCookie: (name: string) => {
    req.deleted.push(name)
    req.cookies.delete(name)
  },
  getRequestHeader: (name: string) => req.headers[name],
  getRequestIP: () => req.ip,
  getRequestUrl: () => new URL('https://x/'),
}))
vi.mock('~/server/db', () => ({ getDb: () => req.db }))

const h = await import('./handlers')

const ON = { WEBAUTHN_RP_ID: CONFIG.rpId, WEBAUTHN_ORIGIN: CONFIG.origin }
const OFF = {}
const CHALLENGE = '__Host-tm_pk_challenge'
const SESSION = '__Host-tm_session'

let f: Family
beforeEach(() => {
  f = family()
  req.db = f.db
  req.cookies = new Map()
  req.set = []
  req.deleted = []
  req.headers = { 'user-agent': IPHONE_UA }
  req.ip = '10.0.0.2'
})

async function enrol(device = phone()) {
  const started = await h.passkeyRegisterOptions(f.tata, ON)
  if (!started.ok) throw new Error(started.error)
  const reply = await h.passkeyRegister(
    f.tata,
    device.register(JSON.parse(started.optionsJson) as PublicKeyCredentialCreationOptionsJSON),
    ON,
  )
  return { device, reply }
}

describe('passkeys off (no WEBAUTHN_RP_ID)', () => {
  it('answers disabled and stores nothing', async () => {
    expect(h.passkeysEnabled(OFF)).toBe(false)
    expect(await h.passkeyLoginOptions(OFF)).toEqual({ ok: false, error: 'disabled' })
    expect(await h.passkeyLogin({} as AuthenticationResponseJSON, OFF)).toEqual({
      ok: false,
      error: 'disabled',
    })
    expect(await h.passkeyRegisterOptions(f.tata, OFF)).toEqual({ ok: false, error: 'disabled' })
    expect(await h.passkeyRegister(f.tata, {} as RegistrationResponseJSON, OFF)).toEqual({
      ok: false,
      error: 'disabled',
    })
    expect(req.set).toEqual([])
    expect(f.db.select().from(passkeyChallenges).all()).toEqual([])
  })

  it('still lists and removes passkeys', async () => {
    const { reply } = await enrol()
    if (!reply.ok) throw new Error(reply.error)
    expect(h.listMyPasskeys(f.tata)).toHaveLength(1)
    expect(h.removeMyPasskey(f.tata, reply.passkey.id)).toEqual({ ok: true })
    expect(h.listMyPasskeys(f.tata)).toEqual([])
  })
})

describe('passkeys on', () => {
  it('registers: the reply is { ok, passkey } only', async () => {
    expect(h.passkeysEnabled(ON)).toBe(true)
    const { reply } = await enrol()
    expect(Object.keys(reply).sort()).toEqual(['ok', 'passkey'])
    expect(f.db.select().from(passkeys).get()?.deviceKind).toBe('iphone')
    expect(req.deleted).toContain(CHALLENGE)
  })

  it('logs in: session cookie set, challenge cookie cleared, no token in the reply', async () => {
    const { device } = await enrol()
    req.set = []
    const options = await h.passkeyLoginOptions(ON)
    if (!options.ok) throw new Error(options.error)
    expect(req.set.map((c) => c.name)).toEqual([CHALLENGE])
    const reply = await h.passkeyLogin(
      device.authenticate(JSON.parse(options.optionsJson) as PublicKeyCredentialRequestOptionsJSON),
      ON,
    )
    expect(Object.keys(reply).sort()).toEqual(['ok', 'user'])
    const session = req.set.find((c) => c.name === SESSION)
    expect(session?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(reply)).not.toContain(session?.value)
    expect(req.cookies.has(CHALLENGE)).toBe(false)
  })

  it('passkey login in a frame returns frameToken and sets no cookie', async () => {
    const { device } = await enrol()
    req.set = []
    req.headers['x-tm-frame'] = '-'
    const options = await h.passkeyLoginOptions(ON)
    if (!options.ok) throw new Error(options.error)
    const reply = await h.passkeyLogin(
      device.authenticate(JSON.parse(options.optionsJson) as PublicKeyCredentialRequestOptionsJSON),
      ON,
    )
    if (!reply.ok) throw new Error(reply.error)
    expect(Object.keys(reply).sort()).toEqual(['frameToken', 'ok', 'user'])
    expect(reply.frameToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(req.set.map((c) => c.name)).toEqual([CHALLENGE])
    expect(req.deleted).not.toContain(SESSION)
  })

  it('no challenge cookie → expired_challenge', async () => {
    const { device } = await enrol()
    const started = await h.passkeyLoginOptions(ON)
    if (!started.ok) throw new Error(started.error)
    req.cookies.delete(CHALLENGE)
    expect(
      await h.passkeyLogin(
        device.authenticate(
          JSON.parse(started.optionsJson) as PublicKeyCredentialRequestOptionsJSON,
        ),
        ON,
      ),
    ).toEqual({
      ok: false,
      error: 'expired_challenge',
    })
  })

  it('issues login challenges under the caller IP', async () => {
    const key = (ip: string) => createHash('sha256').update(ip).digest('hex')
    await h.passkeyLoginOptions(ON)
    req.ip = '10.0.0.3'
    await h.passkeyLoginOptions(ON)
    expect(
      f.db
        .select()
        .from(passkeyChallenges)
        .all()
        .map((c) => c.ipKey),
    ).toEqual([key('10.0.0.2'), key('10.0.0.3')])
  })

  it('admin counts and removes a user’s passkeys', async () => {
    await enrol()
    await enrol()
    expect(h.listPasskeyCounts()).toEqual({ [f.tata.id]: 2 })
    expect(h.removeAllPasskeysOf(f.admin, f.tata.id)).toEqual({ removed: 2 })
    expect(h.listPasskeyCounts()).toEqual({})
  })
})

// Each handler stops at the first failure: it answers that failure and touches no cookie after
// it (no challenge cookie for a refused start, no session cookie for a refused login).
describe('early returns', () => {
  const names = () => req.set.map((c) => c.name)
  const loginAnswer = (device: ReturnType<typeof phone>, optionsJson: string) =>
    device.authenticate(JSON.parse(optionsJson) as PublicKeyCredentialRequestOptionsJSON)

  it('login options when this IP holds too many challenges → busy, no cookie', async () => {
    for (let i = 0; i < MAX_LOGIN_CHALLENGES_PER_IP; i++) await h.passkeyLoginOptions(ON)
    req.set = []
    expect(await h.passkeyLoginOptions(ON)).toEqual({ ok: false, error: 'busy' })
    expect(req.set).toEqual([])
  })

  it('login with no challenge cookie → expired_challenge, nothing cleared or set', async () => {
    const { device } = await enrol()
    const options = await h.passkeyLoginOptions(ON)
    if (!options.ok) throw new Error(options.error)
    req.cookies.delete(CHALLENGE)
    req.set = []
    req.deleted = []
    expect(await h.passkeyLogin(loginAnswer(device, options.optionsJson), ON)).toEqual({
      ok: false,
      error: 'expired_challenge',
    })
    expect(req.deleted).toEqual([])
    expect(req.set).toEqual([])
  })

  it('a refused login → its error, no session cookie, no session', async () => {
    const { device } = await enrol()
    device.forge()
    const options = await h.passkeyLoginOptions(ON)
    if (!options.ok) throw new Error(options.error)
    req.set = []
    expect(await h.passkeyLogin(loginAnswer(device, options.optionsJson), ON)).toEqual({
      ok: false,
      error: 'unknown_passkey',
    })
    expect(names()).toEqual([])
    expect(f.db.select().from(sessions).all()).toEqual([])
  })

  it('register options when the user holds too many challenges → busy, no cookie', async () => {
    for (let i = 0; i < MAX_REGISTER_CHALLENGES_PER_USER; i++) {
      await h.passkeyRegisterOptions(f.tata, ON)
    }
    req.set = []
    expect(await h.passkeyRegisterOptions(f.tata, ON)).toEqual({ ok: false, error: 'busy' })
    expect(req.set).toEqual([])
  })

  it('register with no challenge cookie → expired_challenge, nothing cleared or stored', async () => {
    const started = await h.passkeyRegisterOptions(f.tata, ON)
    if (!started.ok) throw new Error(started.error)
    req.cookies.delete(CHALLENGE)
    req.deleted = []
    const response = phone().register(
      JSON.parse(started.optionsJson) as PublicKeyCredentialCreationOptionsJSON,
    )
    expect(await h.passkeyRegister(f.tata, response, ON)).toEqual({
      ok: false,
      error: 'expired_challenge',
    })
    expect(req.deleted).toEqual([])
    expect(f.db.select().from(passkeys).all()).toEqual([])
  })

  it('a refused registration → its error, nothing stored', async () => {
    const started = await h.passkeyRegisterOptions(f.tata, ON)
    if (!started.ok) throw new Error(started.error)
    const response = phone().register(
      JSON.parse(started.optionsJson) as PublicKeyCredentialCreationOptionsJSON,
      { userVerified: false },
    )
    expect(await h.passkeyRegister(f.tata, response, ON)).toEqual({
      ok: false,
      error: 'not_verified',
    })
    expect(f.db.select().from(passkeys).all()).toEqual([])
  })
})
