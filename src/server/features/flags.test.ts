import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '~/lib/features'
import { featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { getFlags } from './flags'

describe('getFlags', () => {
  it('reads the launch values the migration seeds: everything off', () => {
    expect(getFlags(createTestDb())).toEqual({
      recurring: false,
      log: false,
      week: false,
      meeting: false,
      periodProposals: false,
    })
    expect(
      createTestDb()
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, 'periodProposals'))
        .get(),
    ).toEqual({ key: 'periodProposals', enabled: false })
  })

  it('reads a switch turned on by hand in the database', () => {
    const db = createTestDb()
    db.run(sql`UPDATE feature_flags SET enabled = 1 WHERE key = 'recurring'`)
    expect(getFlags(db)).toEqual({ ...NO_FEATURES, recurring: true })
  })

  it('reads a switch with no row as off', () => {
    const db = createTestDb()
    db.update(featureFlags).set({ enabled: true }).run()
    db.delete(featureFlags).where(eq(featureFlags.key, 'week')).run()
    expect(getFlags(db)).toEqual({
      recurring: true,
      log: true,
      week: false,
      meeting: true,
      periodProposals: true,
    })
  })

  it('ignores a row for a switch the code does not know', () => {
    const db = createTestDb()
    db.insert(featureFlags).values({ key: 'teleport', enabled: true }).run()
    expect(getFlags(db)).toEqual(NO_FEATURES)
  })

  it('refuses a hand edit that is not 0 or 1', () => {
    const db = createTestDb()
    // The raw driver, as the sqlite3 CLI would run it (drizzle wraps the error).
    expect(() =>
      db.$client.exec("UPDATE feature_flags SET enabled = 'true' WHERE key = 'log'"),
    ).toThrow(/CHECK constraint failed/)
    expect(getFlags(db).log).toBe(false)
  })
})
