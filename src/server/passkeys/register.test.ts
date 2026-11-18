import { describe, expect, it } from 'vitest'
import { passkeys } from '~/server/db/schema'
import { setPasswordHash } from '~/server/users'
import { hashPassword } from '~/server/auth'
import {
  at,
  auditOf,
  breakAudit,
  CONFIG,
  family,
  IPHONE_UA,
  must,
  phone,
  T0,
} from '../../../tests/support/passkeys'
import type { SoftAuthenticator } from '../../../tests/support/softAuthenticator'
import { issueChallenge } from './challenges'
import { finishRegistration, startRegistration } from './register'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'

async function enrol(db: Db, user: CurrentUser, device: SoftAuthenticator, now = T0) {
  const { token, options } = must(await startRegistration(db, user, CONFIG, now))
  const response = device.register(options)
  return {
    options,
    response,
    result: await finishRegistration(
      db,
      user,
      { token, response, userAgent: IPHONE_UA },
      CONFIG,
      at(1000),
    ),
  }
}

describe('registration (spec §11 Passkeys)', () => {
  it('stores the passkey and returns only the summary', async () => {
    const { db, tata } = family()
    const device = phone()
    const { response, result } = await enrol(db, tata, device)
    const summary = must(result)
    expect(Object.keys(summary).sort()).toEqual([
      'backedUp',
      'createdAt',
      'deviceKind',
      'id',
      'lastUsedAt',
    ])
    expect(summary).toMatchObject({ deviceKind: 'iphone', backedUp: true, lastUsedAt: null })
    const [row] = db.select().from(passkeys).all()
    expect(row).toMatchObject({ userId: tata.id, credentialId: response.id, counter: 0 })
    const entries = auditOf(db, 'passkey.registered')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entityType: 'passkey', entityId: String(summary.id) })
    const logged = JSON.stringify(entries)
    expect(logged).not.toContain(response.id)
    expect(logged).not.toContain(row?.userHandle)
    expect(logged).not.toContain(Buffer.from(row?.publicKey ?? []).toString('base64'))
  })

  it('asks for a discoverable, user-verified passkey with pinned algorithms', async () => {
    const { db, tata } = family()
    const { options } = must(await startRegistration(db, tata, CONFIG, T0))
    expect(options.authenticatorSelection).toEqual({
      residentKey: 'required',
      userVerification: 'required',
      requireResidentKey: true,
    })
    expect(options.attestation).toBe('none')
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-8, -7, -257])
    expect(options.rp).toEqual({ id: 'tm.test', name: 'Taskmaster' })
    expect(options.user.name).toBe('tata')
  })

  it("a user's second passkey keeps the user handle and excludes the first", async () => {
    const { db, tata } = family()
    const first = await enrol(db, tata, phone())
    const { options } = must(await startRegistration(db, tata, CONFIG, at(2000)))
    expect(options.user.id).toBe(first.options.user.id)
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual([first.response.id])
  })

  it("two users get different handles and never see each other's credentials", async () => {
    const { db, tata, starsi } = family()
    const first = await enrol(db, tata, phone())
    const { options } = must(await startRegistration(db, starsi, CONFIG, at(2000)))
    expect(options.user.id).not.toBe(first.options.user.id)
    expect(options.excludeCredentials).toEqual([])
  })

  it('a challenge works once', async () => {
    const { db, tata } = family()
    const { token, options } = must(await startRegistration(db, tata, CONFIG, T0))
    const response = phone().register(options)
    const input = { token, response, userAgent: IPHONE_UA }
    must(await finishRegistration(db, tata, input, CONFIG, at(1)))
    expect(await finishRegistration(db, tata, input, CONFIG, at(2))).toEqual({
      ok: false,
      error: 'expired_challenge',
    })
  })

  it("another user can't finish tata's registration", async () => {
    const { db, tata, starsi } = family()
    const { token, options } = must(await startRegistration(db, tata, CONFIG, T0))
    const response = phone().register(options)
    expect(
      await finishRegistration(
        db,
        starsi,
        { token, response, userAgent: IPHONE_UA },
        CONFIG,
        at(1),
      ),
    ).toEqual({ ok: false, error: 'expired_challenge' })
    expect(db.select().from(passkeys).all()).toEqual([])
  })

  it('a login challenge does not register', async () => {
    const { db, tata } = family()
    const { options } = must(await startRegistration(db, tata, CONFIG, T0))
    const login = issueChallenge(db, { purpose: 'login', ip: '10.0.0.1' }, T0)
    const response = phone().register({ ...options, challenge: login?.challenge ?? '' })
    expect(
      await finishRegistration(
        db,
        tata,
        { token: login?.token ?? '', response, userAgent: IPHONE_UA },
        CONFIG,
        at(1),
      ),
    ).toEqual({ ok: false, error: 'expired_challenge' })
  })

  it.each([
    ['user not verified', { userVerified: false }],
    ['another origin', { origin: 'https://evil.test' }],
    ['another RP ID', { rpId: 'evil.test' }],
  ])('%s → not_verified, nothing stored', async (_, flags) => {
    const { db, tata } = family()
    const { token, options } = must(await startRegistration(db, tata, CONFIG, T0))
    const response = phone().register(options, flags)
    expect(
      await finishRegistration(db, tata, { token, response, userAgent: IPHONE_UA }, CONFIG, at(1)),
    ).toEqual({ ok: false, error: 'not_verified' })
    expect(db.select().from(passkeys).all()).toEqual([])
  })

  it('the same credential twice → already_registered', async () => {
    const { db, tata } = family()
    const device = phone()
    const first = await enrol(db, tata, device)
    must(first.result)
    const { token, options } = must(await startRegistration(db, tata, CONFIG, at(2000)))
    const again = device.replay(first.response, options)
    expect(
      await finishRegistration(
        db,
        tata,
        { token, response: again, userAgent: IPHONE_UA },
        CONFIG,
        at(3000),
      ),
    ).toEqual({ ok: false, error: 'already_registered' })
    expect(db.select().from(passkeys).all()).toHaveLength(1)
  })

  it('rolls back when the audit write fails', async () => {
    const { db, tata } = family()
    breakAudit(db, 'passkey.registered')
    await expect(enrol(db, tata, phone())).rejects.toThrow(/audit down/)
    expect(db.select().from(passkeys).all()).toEqual([])
  })

  it('an admin password reset leaves passkeys in place', async () => {
    const { db, admin, tata } = family()
    must((await enrol(db, tata, phone())).result)
    must(
      setPasswordHash(
        db,
        { kind: 'user', userId: admin.id },
        tata.id,
        await hashPassword('nové heslo 123'),
        at(5000),
      ),
    )
    expect(db.select().from(passkeys).all()).toHaveLength(1)
  })
})
