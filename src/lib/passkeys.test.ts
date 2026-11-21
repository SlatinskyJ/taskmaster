import { beforeEach, describe, expect, it, vi } from 'vitest'

// The browser side of passkeys with the WebAuthn library and the server functions faked.

const lib = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  sendSignal: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
  browserSupportsWebAuthnAutofill: vi.fn(() => Promise.resolve(true)),
}))
const fns = vi.hoisted(() => ({
  passkeyLoginOptionsFn: vi.fn(),
  passkeyLoginFn: vi.fn(),
  passkeyRegisterOptionsFn: vi.fn(),
  passkeyRegisterFn: vi.fn(),
}))
// The node test environment has no localStorage; a Map stands in for it.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
})
vi.mock('@simplewebauthn/browser', () => lib)
vi.mock('~/server/passkeys/functions', () => fns)

const { addPasskey, createLoginFlow, loginWithPasskey, setThisDevicePasskey, thisDevicePasskey } =
  await import('./passkeys')

const USER = { id: 2, username: 'tata', displayName: 'Táta', role: 'giver' as const }
const LOGIN_OPTIONS = { challenge: 'abc', rpId: 'tm.test', allowCredentials: [] }
const REGISTER_OPTIONS = { challenge: 'def', rp: { id: 'tm.test', name: 'Taskmaster' } }
const ANSWER = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} }

function named(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
  fns.passkeyLoginOptionsFn.mockResolvedValue({
    ok: true,
    optionsJson: JSON.stringify(LOGIN_OPTIONS),
  })
  fns.passkeyRegisterOptionsFn.mockResolvedValue({
    ok: true,
    optionsJson: JSON.stringify(REGISTER_OPTIONS),
  })
  lib.startAuthentication.mockResolvedValue(ANSWER)
  lib.startRegistration.mockResolvedValue(ANSWER)
  lib.sendSignal.mockResolvedValue(undefined)
})

describe('loginWithPasskey', () => {
  it('ok passes the parsed options and returns the user', async () => {
    fns.passkeyLoginFn.mockResolvedValue({ ok: true, user: USER })
    expect(await loginWithPasskey()).toEqual({ ok: true, user: USER })
    expect(lib.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: LOGIN_OPTIONS,
      useBrowserAutofill: false,
    })
    expect(fns.passkeyLoginFn).toHaveBeenCalledWith({ data: ANSWER })
  })

  it('autofill passes useBrowserAutofill: true', async () => {
    fns.passkeyLoginFn.mockResolvedValue({ ok: true, user: USER })
    await loginWithPasskey({ autofill: true })
    expect(lib.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: LOGIN_OPTIONS,
      useBrowserAutofill: true,
    })
  })

  it.each(['NotAllowedError', 'AbortError'])('%s → cancelled', async (name) => {
    lib.startAuthentication.mockRejectedValue(named(name))
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'cancelled' })
    expect(fns.passkeyLoginFn).not.toHaveBeenCalled()
  })

  it('another throw → failed', async () => {
    lib.startAuthentication.mockRejectedValue(named('SecurityError'))
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'failed' })
  })

  it('a server function that throws → failed', async () => {
    fns.passkeyLoginFn.mockRejectedValue(new Error('500'))
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'failed' })
  })

  it('options busy → busy, and no ceremony starts', async () => {
    fns.passkeyLoginOptionsFn.mockResolvedValue({ ok: false, error: 'busy' })
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'busy' })
    expect(lib.startAuthentication).not.toHaveBeenCalled()
  })

  it('options disabled → failed', async () => {
    fns.passkeyLoginOptionsFn.mockResolvedValue({ ok: false, error: 'disabled' })
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'failed' })
  })

  it('unknown_passkey → unknown, and the browser is told to forget it', async () => {
    fns.passkeyLoginFn.mockResolvedValue({ ok: false, error: 'unknown_passkey' })
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'unknown' })
    expect(lib.sendSignal).toHaveBeenCalledWith({
      signalName: 'unknownCredential',
      rpID: 'tm.test',
      credentialID: 'cred-1',
    })
  })

  it('unknown_passkey where the browser has no signal API → still unknown', async () => {
    fns.passkeyLoginFn.mockResolvedValue({ ok: false, error: 'unknown_passkey' })
    lib.sendSignal.mockRejectedValue(new Error('not supported'))
    expect(await loginWithPasskey()).toEqual({ ok: false, reason: 'unknown' })
  })

  it.each([
    ['rate_limited', 'rate_limited'],
    ['expired_challenge', 'failed'],
    ['not_verified', 'failed'],
    ['disabled', 'failed'],
    ['busy', 'failed'],
  ])('server %s → %s', async (error, reason) => {
    fns.passkeyLoginFn.mockResolvedValue({ ok: false, error })
    expect(await loginWithPasskey()).toEqual({ ok: false, reason })
  })
})

describe('addPasskey', () => {
  it('ok, and this browser remembers the new passkey as its own', async () => {
    setThisDevicePasskey(null)
    fns.passkeyRegisterFn.mockResolvedValue({ ok: true, passkey: { id: 1 } })
    expect(await addPasskey()).toEqual({ ok: true })
    expect(thisDevicePasskey()).toBe(1)
    expect(lib.startRegistration).toHaveBeenCalledWith({ optionsJSON: REGISTER_OPTIONS })
    expect(fns.passkeyRegisterFn).toHaveBeenCalledWith({ data: ANSWER })
  })

  it('a failed add leaves the remembered passkey alone', async () => {
    setThisDevicePasskey(5)
    fns.passkeyRegisterFn.mockResolvedValue({ ok: false, error: 'not_verified' })
    expect(await addPasskey()).toEqual({ ok: false, reason: 'failed' })
    expect(thisDevicePasskey()).toBe(5)
  })

  it('already_registered → already', async () => {
    fns.passkeyRegisterFn.mockResolvedValue({ ok: false, error: 'already_registered' })
    expect(await addPasskey()).toEqual({ ok: false, reason: 'already' })
  })

  it('the device already holds one (InvalidStateError) → already', async () => {
    lib.startRegistration.mockRejectedValue(named('InvalidStateError'))
    expect(await addPasskey()).toEqual({ ok: false, reason: 'already' })
  })

  it('NotAllowedError → cancelled', async () => {
    lib.startRegistration.mockRejectedValue(named('NotAllowedError'))
    expect(await addPasskey()).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('options busy → failed', async () => {
    fns.passkeyRegisterOptionsFn.mockResolvedValue({ ok: false, error: 'busy' })
    expect(await addPasskey()).toEqual({ ok: false, reason: 'failed' })
    expect(lib.startRegistration).not.toHaveBeenCalled()
  })

  it('a server function that throws → failed', async () => {
    fns.passkeyRegisterOptionsFn.mockRejectedValue(new Error('offline'))
    expect(await addPasskey()).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('thisDevicePasskey', () => {
  it('reads back what was set, and null once cleared or junk', () => {
    setThisDevicePasskey(9)
    expect(thisDevicePasskey()).toBe(9)
    setThisDevicePasskey(null)
    expect(thisDevicePasskey()).toBeNull()
    localStorage.setItem('tm-passkey-here', 'x')
    expect(thisDevicePasskey()).toBeNull()
  })
})

describe('createLoginFlow (one ceremony at a time)', () => {
  type Outcome = Awaited<ReturnType<typeof loginWithPasskey>>
  const fail = (reason: string) => ({ ok: false, reason }) as Outcome
  const OK: Outcome = { ok: true, user: USER }

  function flow(...outcomes: Outcome[]) {
    const login = vi.fn<typeof loginWithPasskey>()
    for (const o of outcomes) login.mockResolvedValueOnce(o)
    login.mockResolvedValue(fail('cancelled'))
    const onDone = vi.fn()
    return { login, onDone, f: createLoginFlow({ login, onDone }) }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it.each(['cancelled', 'failed', 'busy'])('autofill %s → dropped, not restarted', async (r) => {
    const { login, onDone, f } = flow(fail(r))
    f.startAutofill()
    await tick()
    expect(login).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('autofill ok → onDone(ok)', async () => {
    const { onDone, f } = flow(OK)
    f.startAutofill()
    await tick()
    expect(onDone).toHaveBeenCalledWith(OK)
  })

  it.each(['unknown', 'rate_limited'])('autofill %s → shown', async (r) => {
    const { onDone, f } = flow(fail(r))
    f.startAutofill()
    await tick()
    expect(onDone).toHaveBeenCalledWith(fail(r))
  })

  it('autofill runs at most once at a time', () => {
    const { login, f } = flow()
    login.mockReturnValue(new Promise(() => undefined))
    f.startAutofill()
    f.startAutofill()
    expect(login).toHaveBeenCalledTimes(1)
  })

  it.each(['cancelled', 'failed'])('button %s → autofill restarted once', async (r) => {
    const { login, onDone, f } = flow(fail(r))
    await f.clickButton()
    await tick()
    expect(onDone).toHaveBeenCalledWith(fail(r))
    expect(login.mock.calls).toEqual([[], [{ autofill: true }]])
  })

  it('button busy → no restart', async () => {
    const { login, f } = flow(fail('busy'))
    await f.clickButton()
    await tick()
    expect(login.mock.calls).toEqual([[]])
  })

  it('button ok → onDone(ok), no restart', async () => {
    const { login, onDone, f } = flow(OK)
    await f.clickButton()
    await tick()
    expect(onDone).toHaveBeenCalledWith(OK)
    expect(login).toHaveBeenCalledTimes(1)
  })

  it('a pending autofill answered after the button pressed is ignored, not shown or restarted', async () => {
    const { login, onDone, f } = flow()
    let abortAutofill: (o: Outcome) => void = () => undefined
    login.mockImplementationOnce(() => new Promise((r) => (abortAutofill = r)))
    login.mockResolvedValueOnce(OK)
    f.startAutofill()
    const click = f.clickButton()
    // A stale answer that would be shown if it still counted.
    abortAutofill(fail('unknown'))
    await click
    await tick()
    expect(login.mock.calls).toEqual([[{ autofill: true }], []])
    expect(onDone.mock.calls).toEqual([[OK]])
  })
})
