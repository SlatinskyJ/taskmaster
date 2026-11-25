import { asc, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { settlements } from '~/server/db/schema'
import { listPeriods } from '~/server/periods'
import { meetingNow, settleNow } from './actions'
import { CUTOFF, doneTask, MEETING, plus, prague, SAT, week } from './testing'

// The meeting server functions' bodies (#211): each reads the `settleLastDay` switch itself.
// The migrations leave it on (0027).

const WED = prague(2026, 11, 25, 10)

function example() {
  const f = week()
  doneTask(f, { score: 100, completedAt: plus(SAT, 3_600_000), earner: f.starsi })
  doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.mladsi })
  return f
}

const shown = (db: Db, now: Date) => {
  const m = meetingNow(db, now)
  return m.period ? m.takers.map((t) => ({ takerId: t.id, total: t.total })) : []
}
const rows = (db: Db) => db.select().from(settlements).orderBy(asc(settlements.id)).all()
const switchOff = (db: Db) => {
  db.run(sql`UPDATE feature_flags SET enabled = 0 WHERE key = 'settleLastDay'`)
}

describe('meetingNow and settleNow, switch on (as migrated)', () => {
  it('mid-week: the meeting is exactly the running week’s end', () => {
    const f = example()
    expect(meetingNow(f.db, WED)).toStrictEqual({
      period: null,
      runningCutoffAt: CUTOFF.toISOString(),
    })
  })

  it('mid-week: settling is refused and writes nothing', () => {
    const f = example()
    const data = { periodId: f.p1.id, shown: [] }
    expect(settleNow(f.db, f.tata, data, WED)).toEqual({ ok: false, error: 'nothing_to_settle' })
    expect(rows(f.db)).toEqual([])
    expect(listPeriods(f.db)[0]?.endedAt ?? null).toBeNull()
  })

  it('on the last day both work', () => {
    const f = example()
    expect(meetingNow(f.db, MEETING).period?.id).toBe(f.p1.id)
    const r = settleNow(f.db, f.tata, { periodId: f.p1.id, shown: shown(f.db, MEETING) }, MEETING)
    expect(r.ok).toBe(true)
    expect(rows(f.db)).toHaveLength(2)
  })
})

describe('meetingNow and settleNow, switch off by hand', () => {
  it('mid-week: the running week is offered and settles', () => {
    const f = example()
    switchOff(f.db)
    const m = meetingNow(f.db, WED)
    expect(m.period?.id).toBe(f.p1.id)
    expect(m).not.toHaveProperty('runningCutoffAt')
    const r = settleNow(f.db, f.tata, { periodId: f.p1.id, shown: shown(f.db, WED) }, WED)
    expect(r.ok).toBe(true)
    expect(rows(f.db)).toHaveLength(2)
  })
})
