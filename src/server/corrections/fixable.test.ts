import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { settlements } from '~/server/db/schema'
import { openDisputeIn } from '~/server/disputes'
import { getMeeting, settlePeriod, takerPointsNow } from '~/server/settlement'
import { doneTask, MEETING, plus, SAT, week } from '~/server/settlement/testing'
import { must } from '~/server/tasks/testing'
import { correctSettlementIn } from './corrections'
import { FIX_WEEKS_MAX, getFixable } from './fixable'

// The weeks and totals the admin's fix sheet picks from (#48 screens).

const H = 3_600_000
const WEEK = 7 * 24 * H

type F = ReturnType<typeof week>

function settle(db: Db, tata: number, now: Date) {
  const m = getMeeting(db, now)
  if (!m.period) throw new Error('nothing to settle')
  must(
    settlePeriod(
      db,
      tata,
      m.period.id,
      m.takers.map((t) => ({ takerId: t.id, total: t.total })),
      now,
    ),
  )
}

/** `n` weeks, each settled at its Sunday meeting; both boys earn 60 in each. */
function weeks(n: number) {
  const f = week()
  for (let k = 0; k < n; k++) {
    const meeting = plus(MEETING, k * WEEK)
    doneTask(f, { score: 60, completedAt: plus(meeting, -H), earner: f.starsi })
    doneTask(f, { score: 60, completedAt: plus(meeting, -H), earner: f.mladsi })
    settle(f.db, f.tata, meeting)
  }
  return f
}

const settlementIds = (f: F, taker: number) =>
  f.db
    .select()
    .from(settlements)
    .where(eq(settlements.takerId, taker))
    .orderBy(asc(settlements.id))
    .all()
    .map((s) => s.id)

describe('getFixable', () => {
  it('lists the boys only, each with his own weeks, newest first, and his total now', () => {
    const f = weeks(3)
    const list = getFixable(f.db)
    expect(list.map((t) => [t.id, t.name])).toEqual([
      [f.starsi, 'Starší'],
      [f.mladsi, 'Mladší'],
    ])
    const totals = takerPointsNow(f.db)
    for (const t of list) {
      expect(t.weeks.map((w) => w.settlementId)).toEqual([...settlementIds(f, t.id)].reverse())
      expect(t.total).toBe(totals.get(t.id)?.confirmed ?? 0)
    }
  })

  it('a week holds its span, levels and settled numbers', () => {
    const f = weeks(1)
    const [t] = getFixable(f.db)
    expect(t?.weeks).toEqual([
      {
        settlementId: settlementIds(f, f.starsi)[0],
        startsAt: SAT.toISOString(),
        endsAt: MEETING.toISOString(),
        levels: { lower: 50, upper: 100 },
        totalBefore: 60,
        carryOver: 10,
        level: 'lower',
        deducted: 50,
        corrected: false,
      },
    ])
  })

  it('a week corrected twice shows the second correction as its level', () => {
    const f = weeks(1)
    const id = settlementIds(f, f.starsi)[0] ?? 0
    must(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: id, level: 'none', reason: 'A' },
        null,
        plus(MEETING, H),
      ),
    )
    must(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: id, level: 'lower', reason: 'B' },
        null,
        plus(MEETING, 2 * H),
      ),
    )
    const w = getFixable(f.db)[0]?.weeks[0]
    expect([w?.level, w?.deducted, w?.corrected]).toEqual(['lower', 50, true])
  })

  it(`nine weeks: the ${String(FIX_WEEKS_MAX)} newest; the oldest only while a dispute on it is open`, () => {
    const f = weeks(9)
    const ids = settlementIds(f, f.starsi)
    const now = plus(MEETING, 9 * WEEK)
    expect(getFixable(f.db)[0]?.weeks.map((w) => w.settlementId)).toEqual(ids.slice(1).reverse())
    const oldest = ids[0] ?? 0
    must(openDisputeIn(f.db, f.starsi, { kind: 'settlement', id: oldest }, 'Bylo to víc', now))
    expect(getFixable(f.db)[0]?.weeks.map((w) => w.settlementId)).toEqual([...ids].reverse())
  })

  it('a boy with no settled week has none', () => {
    const f = week()
    expect(getFixable(f.db).map((t) => t.weeks)).toEqual([[], []])
  })
})
