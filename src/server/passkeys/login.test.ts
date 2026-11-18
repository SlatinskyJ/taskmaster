import { eq } from 'drizzle-orm'
import type * as WebAuthnServer from '@simplewebauthn/server'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_FAILURES_PER_USER,
  resolveSession,
  toCurrentUser,
  FAILURE_WINDOW_MS,
} from '~/server/auth'
import { login as passwordLogin, hashPassword } from '~/server/auth'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { loginFailures, passkeys, sessions, users } from '~/server/db/schema'
import { setPasswordHash, updateUser } from '~/server/users'
import {
  at,
  auditOf,
  breakAudit,
  CONFIG,
  family,
  IP,
  IPHONE_UA,
  must,
  phone,
  T0,
} from '../../../tests/support/passkeys'
import type { SoftAuthenticator } from '../../../tests/support/softAuthenticator'
import { issueChallenge } from './challenges'
import { finishRegistration, startRegistration } from './register'

// A hook so one test can delete the passkey while its verify is running.
const hooks = vi.hoisted(() => ({ afterVerify: undefined as (() => void) | undefined }))
vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const real = await importOriginal<typeof WebAuthnServer>()
  return {
    ...real,
    verifyAuthenticationResponse: async (
      ...args: Parameters<typeof real.verifyAuthenticationResponse>
    ) => {
      const result = await real.verifyAuthenticationResponse(...args)
      hooks.afterVerify?.()
      return result
    },
  }
})

const { finishPasskeyLogin, startPasskeyLogin } = await import('./login')

async function enrol(db: Db, user: CurrentUser): Promise<SoftAuthenticator> {
  const device = phone()
  const { token, options } = must(await startRegistration(db, user, CONFIG, T0))
  const response = device.register(options)
  must(await finishRegistration(db, user, { token, response, userAgent: IPHONE_UA }, CONFIG, T0))
  return device
}

type Flags = Parameters<SoftAuthenticator['authenticate']>[1]

async function tryLogin(
  db: Db,
  device: SoftAuthenticator,
  flags: Flags = {},
  now = at(1000),
  ip = IP,
) {
  const { token, options } = must(await startPasskeyLogin(db, ip, CONFIG, now))
  return finishPasskeyLogin(
    db,
    { token, response: device.authenticate(options, flags), ip },
    CONFIG,
    now,
  )
}

const failures = (db: Db) => auditOf(db, 'auth.login_failed')
const afterOf = (entry: { after: string | null } | undefined) =>
  JSON.parse(entry?.after ?? '{}') as Record<string, unknown>

describe('passkey login (spec §11 Passkeys)', () => {
  it('opens a passkey session and stores the counter', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    const now = at(5000)
    const r = must(await tryLogin(db, device, {}, now))
    const row = db.select().from(users).where(eq(users.id, tata.id)).get()
    expect(r.user).toEqual(row && toCurrentUser(row))
    expect(Object.keys(r.user).sort()).toEqual(['displayName', 'id', 'role', 'username'])
    expect(db.select().from(sessions).all()).toEqual([
      expect.objectContaining({ userId: tata.id, method: 'passkey' }),
    ])
    expect(db.select().from(passkeys).get()).toMatchObject({
      counter: 1,
      lastUsedAt: now.toISOString(),
    })
    const ok = auditOf(db, 'auth.login_succeeded')
    expect(ok).toHaveLength(1)
    expect(afterOf(ok[0])).toMatchObject({ method: 'passkey', ip: IP })
    expect(resolveSession(db, r.token, now)?.user.id).toBe(tata.id)
  })

  it('asks the browser for any passkey, user verified', async () => {
    const { db } = family()
    const { options } = must(await startPasskeyLogin(db, IP, CONFIG, T0))
    expect(options.allowCredentials).toEqual([])
    expect(options.userVerification).toBe('required')
    expect(options.rpId).toBe('tm.test')
  })

  it('an unknown passkey → unknown_passkey, logged, no session', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    device.forge()
    expect(await tryLogin(db, device)).toEqual({ ok: false, error: 'unknown_passkey' })
    const [f] = failures(db)
    expect(f).toMatchObject({ actorKind: 'anonymous', entityType: 'user', entityId: 'unknown' })
    expect(afterOf(f)).toEqual({ method: 'passkey', reason: 'unknown_passkey', ip: IP })
    expect(db.select().from(sessions).all()).toEqual([])
  })

  it('a passkey removed before the answer → unknown_passkey', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    const { token, options } = must(await startPasskeyLogin(db, IP, CONFIG, T0))
    db.delete(passkeys).run()
    expect(
      await finishPasskeyLogin(
        db,
        { token, response: device.authenticate(options), ip: IP },
        CONFIG,
        at(1),
      ),
    ).toEqual({ ok: false, error: 'unknown_passkey' })
  })

  it('a passkey removed during the verify → no session', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    hooks.afterVerify = () => db.delete(passkeys).run()
    try {
      expect(await tryLogin(db, device)).toEqual({ ok: false, error: 'unknown_passkey' })
    } finally {
      hooks.afterVerify = undefined
    }
    expect(db.select().from(sessions).all()).toEqual([])
    expect(auditOf(db, 'auth.login_succeeded')).toEqual([])
  })

  it.each([
    ['user not verified', { userVerified: false }],
    ['another origin', { origin: 'https://evil.test' }],
    ['another RP ID', { rpId: 'evil.test' }],
  ])('%s → not_verified, logged against the user', async (_, flags) => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    expect(await tryLogin(db, device, flags)).toEqual({ ok: false, error: 'not_verified' })
    const [f] = failures(db)
    expect(f).toMatchObject({ entityId: String(tata.id) })
    expect(afterOf(f)).toEqual({ method: 'passkey', reason: 'not_verified', ip: IP })
    expect(db.select().from(sessions).all()).toEqual([])
  })

  it('an inactive user gets no session', async () => {
    const { db, admin, tata } = family()
    const device = await enrol(db, tata)
    must(updateUser(db, { kind: 'user', userId: admin.id }, tata.id, { active: false }, at(10)))
    expect(await tryLogin(db, device)).toEqual({ ok: false, error: 'not_verified' })
    expect(afterOf(failures(db).at(-1))).toMatchObject({ reason: 'inactive' })
    expect(db.select().from(sessions).all()).toEqual([])
  })

  it('a replayed counter → not_verified', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    must(await tryLogin(db, device, { counter: 5 }))
    expect(await tryLogin(db, device, { counter: 5 }, at(2000))).toEqual({
      ok: false,
      error: 'not_verified',
    })
  })

  it("another user's handle → not_verified", async () => {
    const { db, tata, starsi } = family()
    const device = await enrol(db, tata)
    await enrol(db, starsi)
    const other = db.select().from(passkeys).where(eq(passkeys.userId, starsi.id)).get()
    expect(await tryLogin(db, device, { userHandle: other?.userHandle })).toEqual({
      ok: false,
      error: 'not_verified',
    })
  })

  it('a challenge works once; a register challenge does not log in', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    const { token, options } = must(await startPasskeyLogin(db, IP, CONFIG, T0))
    const input = { token, response: device.authenticate(options), ip: IP }
    must(await finishPasskeyLogin(db, input, CONFIG, at(1)))
    expect(await finishPasskeyLogin(db, input, CONFIG, at(2))).toEqual({
      ok: false,
      error: 'expired_challenge',
    })
    const reg = issueChallenge(db, { purpose: 'register', userId: tata.id, userHandle: 'h' }, T0)
    const response = device.authenticate({ ...options, challenge: reg?.challenge ?? '' })
    expect(
      await finishPasskeyLogin(db, { token: reg?.token ?? '', response, ip: IP }, CONFIG, at(3)),
    ).toEqual({ ok: false, error: 'expired_challenge' })
    const expired = failures(db).filter((f) => afterOf(f).reason === 'expired_challenge')
    expect(expired).toHaveLength(2)
    expect(expired[0]).toMatchObject({ entityId: 'unknown' })
  })

  it(`locks a passkey after ${String(MAX_FAILURES_PER_USER)} failures`, async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    for (let i = 0; i < MAX_FAILURES_PER_USER - 1; i++) {
      expect((await tryLogin(db, device, { userVerified: false })).ok).toBe(false)
    }
    // The 10th is still checked…
    expect(await tryLogin(db, device, { userVerified: false })).toEqual({
      ok: false,
      error: 'not_verified',
    })
    const logged = failures(db).length
    // …the 11th is refused unchecked and unlogged, even with a good answer.
    expect(await tryLogin(db, device)).toEqual({ ok: false, error: 'rate_limited' })
    expect(failures(db)).toHaveLength(logged)
    // After the window a good login works and clears this passkey's failures.
    must(await tryLogin(db, device, {}, at(1000 + FAILURE_WINDOW_MS + 1)))
    expect(must(await tryLogin(db, device, {}, at(2000 + FAILURE_WINDOW_MS + 1))).user.id).toBe(
      tata.id,
    )
  })

  it("unknown passkeys don't use up the IP's password allowance", async () => {
    const { db, admin, tata } = family()
    const device = await enrol(db, tata)
    device.forge()
    for (let i = 0; i < 40; i++) {
      const now = at(i * 20_000)
      expect(await tryLogin(db, device, {}, now)).toEqual({ ok: false, error: 'unknown_passkey' })
    }
    expect(db.select().from(loginFailures).all()).toEqual([])
    must(
      setPasswordHash(
        db,
        { kind: 'user', userId: admin.id },
        tata.id,
        await hashPassword('heslo 12345'),
        T0,
      ),
    )
    expect(
      (await passwordLogin(db, { username: 'tata', password: 'heslo 12345', ip: IP }, at(900_000)))
        .ok,
    ).toBe(true)
  })

  it('rolls back when the audit write fails', async () => {
    const { db, tata } = family()
    const device = await enrol(db, tata)
    breakAudit(db, 'auth.login_succeeded')
    await expect(tryLogin(db, device)).rejects.toThrow(/audit down/)
    expect(db.select().from(sessions).all()).toEqual([])
    expect(db.select().from(passkeys).get()?.counter).toBe(0)
  })
})
