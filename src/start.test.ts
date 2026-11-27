import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { withAudit } from '~/server/audit'
import { changeScopeMiddleware } from '~/server/live/changeScopeMiddleware'
import { startInstance } from './start'

// The Start instance's request middleware as registered (#304): each request is its own change.

let db: Db
beforeEach(() => {
  db = createTestDb()
})
afterEach(() => {
  db.$client.close()
})

type ServerFn = (ctx: { next: () => Promise<unknown> }) => Promise<unknown>

describe('request middleware', () => {
  it('the change scope is registered first; two requests in one tick are two changes', async () => {
    const options = await startInstance.getOptions()
    const first = options.requestMiddleware?.[0]
    expect(first).toBe(changeScopeMiddleware)
    const server = (first as unknown as { options: { server: ServerFn } }).options.server
    const write = () => {
      withAudit(db, () => undefined, {
        actor: { kind: 'system' },
        action: 'settings.changed',
        entityType: 'app_meta',
        entityId: 'k',
      })
    }
    const request = () =>
      server({
        next: async () => {
          await Promise.resolve()
          write()
          write()
          return null
        },
      })
    await Promise.all([request(), request()])
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .map((r) => [r.id, r.changeId]),
    ).toEqual([
      [1, null],
      [2, 1],
      [3, null],
      [4, 3],
    ])
  })
})
