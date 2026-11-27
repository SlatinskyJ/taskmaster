import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '~/server/db'
import { appMeta, auditLog } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { AUDIT_ACTIONS } from './actions'
import { onAuditWritten, REDACTED, withAudit, writeAudit } from './audit'
import { inChangeScope } from './changeScope'
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
        before: null,
        after: '{"key":"k","value":"v"}',
        reason: 'test',
        changeId: null,
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
        // @ts-expect-error -- async changes are rejected at compile time; this checks the backstop
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
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T17:00:00.123Z'))
    try {
      withAudit(db, () => undefined, entry({ at: undefined }))
    } finally {
      vi.useRealTimers()
    }
    expect(auditRows()[0]?.at).toBe('2026-11-15T17:00:00.123Z')
  })

  it('stores an omitted or null before/after as SQL NULL', () => {
    withAudit(db, () => undefined, [
      entry({ before: undefined, after: undefined }),
      entry({ before: null, after: null }),
    ])
    expect(auditRows().map((r) => [r.before, r.after])).toEqual([
      [null, null],
      [null, null],
    ])
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

  it('rejects a system or anonymous actor with a user id at the DB level', () => {
    expect(() =>
      db.$client
        .prepare(
          "insert into audit_log (at, actor_kind, actor_user_id, action, entity_type, entity_id) values ('x', 'system', 1, 'auth.logout', 'user', '1')",
        )
        .run(),
    ).toThrow(/CHECK constraint/)
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

describe('credentials never reach the log', () => {
  it('redacts credential fields at any depth, keeping everything else', () => {
    withAudit(
      db,
      () => undefined,
      entry({
        before: { name: 'Honza', passwordHash: '$argon2id$...', pin: '1234' },
        after: {
          name: 'Honza',
          password: 'hunter2',
          sessions: [{ id: 1, tokenHash: 'abc' }],
          passkey: { credentialId: 'xyz', credentialPublicKey: 'pk', counter: 3 },
          clientSecret: 's',
          pinCode: '1',
          pin_code: '2',
          newPin: '3',
          challenge: 'c',
          shipping: 'kept', // contains "pin" but is not a PIN
        },
      }),
    )
    const row = auditRows()[0]
    expect(JSON.parse(row?.before ?? '')).toEqual({
      name: 'Honza',
      passwordHash: REDACTED,
      pin: REDACTED,
    })
    expect(JSON.parse(row?.after ?? '')).toEqual({
      name: 'Honza',
      password: REDACTED,
      sessions: [{ id: 1, tokenHash: REDACTED }],
      passkey: { credentialId: REDACTED, credentialPublicKey: REDACTED, counter: 3 },
      clientSecret: REDACTED,
      pinCode: REDACTED,
      pin_code: REDACTED,
      newPin: REDACTED,
      challenge: REDACTED,
      shipping: 'kept',
    })
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

describe('changes (#299)', () => {
  const changeIds = () => auditRows().map((r) => [r.id, r.changeId])
  /** A later request: a fresh task, after every microtask of this one. */
  const nextRequest = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('withAudit with three entries stores change_id null, first.id, first.id', () => {
    withAudit(db, () => undefined, [entry(), entry(), entry()])
    expect(changeIds()).toEqual([
      [1, null],
      [2, 1],
      [3, 1],
    ])
  })

  it('two separate withAudit calls are two changes (both change_id null)', async () => {
    withAudit(db, () => undefined, entry())
    await nextRequest()
    withAudit(db, () => undefined, entry())
    expect(changeIds()).toEqual([
      [1, null],
      [2, null],
    ])
  })

  it('writeAudit twice inside one db.transaction groups them', () => {
    db.transaction((tx) => {
      writeAudit(tx, entry())
      writeAudit(tx, entry())
    })
    expect(changeIds()).toEqual([
      [1, null],
      [2, 1],
    ])
  })

  it('an entry written through a nested tx.transaction joins the outer change', () => {
    db.transaction((tx) => {
      writeAudit(tx, entry())
      tx.transaction((inner) => {
        writeAudit(inner, entry())
      })
    })
    expect(changeIds()).toEqual([
      [1, null],
      [2, 1],
    ])
  })

  it('one synchronous run of several transactions is one change (a scheduler tick)', () => {
    withAudit(db, () => undefined, entry())
    withAudit(db, () => undefined, entry())
    expect(changeIds()).toEqual([
      [1, null],
      [2, 1],
    ])
  })

  it('after a microtask, the next write starts a new change', async () => {
    withAudit(db, () => undefined, entry())
    await Promise.resolve()
    withAudit(db, () => undefined, [entry(), entry()])
    expect(changeIds()).toEqual([
      [1, null],
      [2, null],
      [3, 2],
    ])
  })

  it('a rolled-back first entry does not leave the next change pointing at it', () => {
    expect(() =>
      withAudit(
        db,
        () => {
          throw new Error('boom')
        },
        entry(),
      ),
    ).toThrow('boom')
    expect(() =>
      db.transaction((tx) => {
        writeAudit(tx, entry())
        throw new Error('boom')
      }),
    ).toThrow('boom')
    withAudit(db, () => undefined, [entry(), entry()])
    expect(changeIds()).toEqual([
      [1, null],
      [2, 1],
    ])
  })

  describe('per request (#304)', () => {
    const w = (over: Partial<AuditEntry> = {}) => {
      withAudit(db, () => undefined, entry(over))
    }
    /** A write whose first entry is rolled back after it was written. */
    const rolledBack = (over: Partial<AuditEntry>) => {
      expect(() =>
        db.transaction((tx) => {
          writeAudit(tx, entry(over))
          throw new Error('boom')
        }),
      ).toThrow('boom')
    }

    it('two requests whose runs fall in one tick are two changes', async () => {
      await Promise.all([
        inChangeScope(async () => {
          await Promise.resolve()
          w()
          w()
        }),
        inChangeScope(async () => {
          await Promise.resolve()
          w()
          w()
        }),
      ])
      expect(changeIds()).toEqual([
        [1, null],
        [2, 1],
        [3, null],
        [4, 3],
      ])
    })

    it('two requests whose writes interleave in one tick share no change', async () => {
      await Promise.all([
        inChangeScope(async () => {
          w()
          await Promise.resolve()
          w()
        }),
        inChangeScope(async () => {
          w()
          await Promise.resolve()
          w()
        }),
      ])
      expect(changeIds()).toEqual([
        [1, null],
        [2, null],
        [3, null],
        [4, null],
      ])
    })

    it('one request with an await between two writes is two changes', async () => {
      await inChangeScope(async () => {
        w()
        await Promise.resolve()
        w()
      })
      expect(changeIds()).toEqual([
        [1, null],
        [2, null],
      ])
    })

    it('in a scope, a rolled-back first entry: the next write starts the change again', () => {
      inChangeScope(() => {
        rolledBack({})
        w()
        w()
      })
      expect(changeIds()).toEqual([
        [1, null],
        [2, 1],
      ])
    })

    it('a rolled-back first entry whose id another request took meanwhile: no shared change', async () => {
      inChangeScope(() => {
        queueMicrotask(() => {
          w({ action: 'settings.changed', entityId: 'b' })
        })
      })
      inChangeScope(() => {
        queueMicrotask(() => {
          w({ action: 'task.created', entityType: 'task', entityId: 'a' })
        })
        rolledBack({ action: 'task.created', entityType: 'task', entityId: 'a' })
      })
      await nextRequest()
      expect(auditRows().map((r) => [r.id, r.action, r.changeId])).toEqual([
        [1, 'settings.changed', null],
        [2, 'task.created', null],
      ])
    })

    it('outside a scope too: a freed first id taken by a request does not join its change', async () => {
      rolledBack({ action: 'task.created', entityType: 'task', entityId: 'a' })
      inChangeScope(() => {
        w({ action: 'settings.changed', entityId: 'b' })
      })
      w({ action: 'task.created', entityType: 'task', entityId: 'a' })
      await nextRequest()
      expect(auditRows().map((r) => [r.id, r.action, r.changeId])).toEqual([
        [1, 'settings.changed', null],
        [2, 'task.created', null],
      ])
    })
  })

  it('onAuditWritten gets each row id in order; unsubscribe stops it', () => {
    const heard: unknown[] = []
    const off = onAuditWritten((row) => heard.push(row))
    try {
      withAudit(db, () => undefined, [entry(), entry()])
    } finally {
      off()
    }
    withAudit(db, () => undefined, entry())
    expect(heard).toEqual([
      { id: 1, changeId: null },
      { id: 2, changeId: 1 },
    ])
    expect(auditRows()).toHaveLength(3)
  })

  it('a throwing listener does not roll back the write', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const off = onAuditWritten(() => {
      throw new Error('listener')
    })
    try {
      withAudit(db, (tx) => tx.insert(appMeta).values({ key: 'k', value: 'v' }).run(), entry())
      expect(error).toHaveBeenCalledWith('[audit] write listener failed', expect.any(Error))
    } finally {
      off()
      error.mockRestore()
    }
    expect(auditRows()).toHaveLength(1)
    expect(metaRows()).toHaveLength(1)
  })
})
