import { describe, expect, it } from 'vitest'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { passkeys } from '~/server/db/schema'
import {
  at,
  auditOf,
  breakAudit,
  CONFIG,
  family,
  IPHONE_UA,
  must,
  phone,
} from '../../../tests/support/passkeys'
import { countPasskeysByUser, listPasskeys, removePasskey, removeUserPasskeys } from './manage'
import { finishRegistration, startRegistration } from './register'

async function enrol(db: Db, user: CurrentUser, now: Date) {
  const { token, options } = must(await startRegistration(db, user, CONFIG, now))
  const response = phone().register(options)
  return must(
    await finishRegistration(db, user, { token, response, userAgent: IPHONE_UA }, CONFIG, now),
  )
}

const SUMMARY_KEYS = ['backedUp', 'createdAt', 'deviceKind', 'id', 'lastUsedAt']

describe('list and remove passkeys', () => {
  it("lists only the user's own passkeys, newest first, summary fields only", async () => {
    const { db, tata, starsi } = family()
    const a = await enrol(db, tata, at(1))
    const b = await enrol(db, tata, at(2))
    await enrol(db, starsi, at(3))
    const list = listPasskeys(db, tata.id)
    expect(list.map((p) => p.id)).toEqual([b.id, a.id])
    for (const p of list) expect(Object.keys(p).sort()).toEqual(SUMMARY_KEYS)
  })

  it('removes your own passkey, with an audit entry', async () => {
    const { db, tata } = family()
    const p = await enrol(db, tata, at(1))
    expect(removePasskey(db, tata, p.id, at(10))).toEqual({ ok: true, value: undefined })
    expect(db.select().from(passkeys).all()).toEqual([])
    const [entry] = auditOf(db, 'passkey.removed')
    expect(entry).toMatchObject({
      actorUserId: tata.id,
      entityType: 'passkey',
      entityId: String(p.id),
    })
    expect(JSON.parse(entry?.before ?? '{}')).toEqual({
      userId: tata.id,
      deviceKind: 'iphone',
      createdAt: p.createdAt,
    })
  })

  it("can't remove someone else's passkey, or one that doesn't exist", async () => {
    const { db, tata, starsi } = family()
    const p = await enrol(db, tata, at(1))
    expect(removePasskey(db, starsi, p.id, at(10))).toEqual({ ok: false, error: 'not_found' })
    expect(removePasskey(db, tata, p.id + 99, at(10))).toEqual({ ok: false, error: 'not_found' })
    expect(db.select().from(passkeys).all()).toHaveLength(1)
    expect(auditOf(db, 'passkey.removed')).toEqual([])
  })

  it("the admin removes all of one user's passkeys, one entry each", async () => {
    const { db, admin, tata, starsi } = family()
    await enrol(db, tata, at(1))
    await enrol(db, tata, at(2))
    await enrol(db, starsi, at(3))
    expect(removeUserPasskeys(db, admin, tata.id, at(10))).toBe(2)
    expect(listPasskeys(db, tata.id)).toEqual([])
    expect(listPasskeys(db, starsi.id)).toHaveLength(1)
    const entries = auditOf(db, 'passkey.removed')
    expect(entries).toHaveLength(2)
    for (const e of entries) expect(e).toMatchObject({ actorUserId: admin.id, reason: 'admin' })
    expect(removeUserPasskeys(db, admin, tata.id, at(11))).toBe(0)
    expect(auditOf(db, 'passkey.removed')).toHaveLength(2)
  })

  it('counts passkeys per user', async () => {
    const { db, tata, starsi } = family()
    await enrol(db, tata, at(1))
    await enrol(db, tata, at(2))
    await enrol(db, starsi, at(3))
    expect(countPasskeysByUser(db)).toEqual({ [tata.id]: 2, [starsi.id]: 1 })
  })

  it('rolls back both removals when the audit write fails', async () => {
    const { db, admin, tata } = family()
    const p = await enrol(db, tata, at(1))
    await enrol(db, tata, at(2))
    breakAudit(db, 'passkey.removed')
    expect(() => removePasskey(db, tata, p.id, at(10))).toThrow(/audit down/)
    expect(() => removeUserPasskeys(db, admin, tata.id, at(10))).toThrow(/audit down/)
    expect(db.select().from(passkeys).all()).toHaveLength(2)
  })
})
