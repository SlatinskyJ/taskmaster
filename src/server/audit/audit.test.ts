import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { appMeta, auditLog } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { AUDIT_ACTIONS } from './actions'
import { withAudit, writeAudit } from './audit'
import type { AuditEntry } from './audit'

const dad = { kind: 'user', userId: 7 } as const
const at = new Date('2026-11-16T17:00:00.000Z')

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: dad,
    action: 'settings.changed',
    entityType: 'app_meta',
    entityId: 'k',
    after: { value: 'v' },
    at,
    ...overrides,
  }
}

let db: Db
beforeEach(() => {
  db = createTestDb()
})
afterEach(() => {
  db.$client.close()
})

const metaRows = () => db.select().from(appMeta).all()
const auditRows = () => db.select().from(auditLog).all()

describe('withAudit', () => {
  it('commits the change and its entry together', () => {
    const result = withAudit(
      db,
      (tx) => tx.insert(appMeta).values({ key: 'k', value: 'v' }).returning().get(),
      (row) => entry({ entityId: row.key, before: null, after: row, reason: 'test' }),
    )
    expect(result).toEqual({ key: 'k', value: 'v' })
    expect(metaRows()).toHaveLength(1)
    expect(auditRows()).toEqual([
      {
        id: 1,
        at: '2026-11-16T17:00:00.000Z',
        actorKind: 'user',
        actorUserId: 7,
        action: 'settings.changed',
        entityType: 'app_meta',
        entityId: 'k',
        before: 'null',
        after: '{"key":"k","value":"v"}',
        reason: 'test',
      },
    ])
  })

  it('rolls back the entry when the change throws', () => {
    expect(() =>
      withAudit(
        db,
        (tx) => {
          tx.insert(appMeta).values({ key: 'k', value: 'v' }).run()
          throw new Error('boom')
        },
        entry(),
      ),
    ).toThrow('boom')
    expect(metaRows()).toEqual([])
    expect(auditRows()).toEqual([])
  })

  it('rolls back the change when the audit write fails', () => {
    expect(() =>
      withAudit(
        db,
        (tx) => tx.insert(appMeta).values({ key: 'k', value: 'v' }).run(),
        entry({ after: { n: 1n } }), // BigInt is not JSON-serialisable
      ),
    ).toThrow()
    expect(metaRows()).toEqual([])
    expect(auditRows()).toEqual([])
  })

  it('rolls back the change when the entry builder throws', () => {
    expect(() =>
      withAudit(
        db,
        (tx) => tx.insert(appMeta).values({ key: 'k', value: 'v' }).run(),
        () => {
          throw new Error('no entry')
        },
      ),
    ).toThrow('no entry')
    expect(metaRows()).toEqual([])
  })

  it('writes several entries for one change, all or nothing', () => {
    withAudit(db, (tx) => tx.insert(appMeta).values({ key: 'k', value: 'v' }).run(), [
      entry({ entityId: 1 }),
      entry({ entityId: 2 }),
    ])
    expect(auditRows().map((r) => r.entityId)).toEqual(['1', '2'])

    expect(() =>
      withAudit(db, (tx) => tx.insert(appMeta).values({ key: 'k2', value: 'v' }).run(), [
        entry({ entityId: 3 }),
        entry({ entityId: 4, before: () => 1 }), // not serialisable: the whole change rolls back
      ]),
    ).toThrow()
    expect(auditRows().map((r) => r.entityId)).toEqual(['1', '2'])
    expect(metaRows().map((r) => r.key)).toEqual(['k'])
  })

  it('refuses a change with no entries', () => {
    expect(() =>
      withAudit(db, (tx) => tx.insert(appMeta).values({ key: 'k', value: 'v' }).run(), []),
    ).toThrow('at least one entry')
    expect(metaRows()).toEqual([])
  })

  it('refuses an async change and rolls it back', () => {
    expect(() =>
      withAudit(
        db,
        // eslint-disable-next-line @typescript-eslint/require-await -- the point of the test
        async (tx) => {
          tx.insert(appMeta).values({ key: 'k', value: 'v' }).run()
        },
        entry(),
      ),
    ).toThrow('synchronous')
    expect(metaRows()).toEqual([])
    expect(auditRows()).toEqual([])
  })

  it('stamps the current time when no instant is given', () => {
    const before = Date.now()
    withAudit(db, () => undefined, entry({ at: undefined }))
    const row = auditRows()[0]
    expect(row).toBeDefined()
    const stamped = Date.parse(row?.at ?? '')
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
    expect(row?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  })
})

describe('actors', () => {
  it('stores system and anonymous actors without a user id', () => {
    withAudit(db, () => undefined, [
      entry({ actor: { kind: 'system' }, action: 'instance.expired' }),
      entry({ actor: { kind: 'anonymous' }, action: 'auth.login_failed', after: { name: 'x' } }),
    ])
    expect(auditRows().map((r) => [r.actorKind, r.actorUserId])).toEqual([
      ['system', null],
      ['anonymous', null],
    ])
  })

  it('rejects a user actor without an id at the DB level', () => {
    expect(() =>
      db.$client
        .prepare(
          "insert into audit_log (at, actor_kind, action, entity_type, entity_id) values ('x', 'user', 'auth.logout', 'user', '1')",
        )
        .run(),
    ).toThrow(/CHECK constraint/)
  })
})

describe('append-only', () => {
  beforeEach(() => {
    db.transaction((tx) => {
      writeAudit(tx, entry())
    })
  })

  it('rejects UPDATE', () => {
    expect(() => db.update(auditLog).set({ reason: 'rewritten' }).run()).toThrow(
      'audit_log is append-only',
    )
    expect(auditRows()[0]?.reason).toBeNull()
  })

  it('rejects DELETE', () => {
    expect(() => db.delete(auditLog).where(eq(auditLog.id, 1)).run()).toThrow(
      'audit_log is append-only',
    )
    expect(auditRows()).toHaveLength(1)
  })

  it('rejects invalid JSON in before/after', () => {
    expect(() =>
      db.$client
        .prepare(
          "insert into audit_log (at, actor_kind, action, entity_type, entity_id, after) values ('x', 'system', 'auth.logout', 'user', '1', 'not json')",
        )
        .run(),
    ).toThrow(/CHECK constraint/)
  })
})

describe('action types', () => {
  it('are unique and follow <entity>.<verb>', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[a-z]+\.[a-z_]+$/)
  })
})
