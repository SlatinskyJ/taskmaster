import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { auditLog } from '~/server/db/schema'
import { schedulerJobs } from '~/server/scheduler/jobs'
import { completeTaskHandler } from '~/server/tasks/functions'
import { taskHistory } from '~/server/tasks/history'
import { completeTask, rejectTask, reserveTask } from '~/server/tasks/lifecycle'
import { json, must, row } from '~/server/tasks/testing'
import { THU_0005, WED_NOON, copiesOf, prague, setWeekPlan, weekFamily } from './testing'
import type { WeekFamily } from './testing'
import { dropWeekRules } from './weekRules'

// Turning the week plan off drops the day rules for good (#257, ruling 2): a copy made in an
// earlier on-spell never gets them back.

const THU_10 = prague(12, 3, 10)
const MON_10_30 = prague(11, 30, 10, 30)

/** Runs one scheduler job by name at `at`. */
function job(f: WeekFamily, name: string, at: Date, log = { info: vi.fn(), error: vi.fn() }) {
  const j = schedulerJobs(f.db, () => DEFAULT_PERIOD_DEFAULTS, log).find((x) => x.name === name)
  if (!j) throw new Error(`no job ${name}`)
  j.run(at)
  return log
}

const drops = (f: WeekFamily) =>
  f.db.select().from(auditLog).where(eq(auditLog.action, 'instance.week_rules_dropped')).all()

describe('dropWeekRules (#257)', () => {
  it('switch off: the next tick drops week_rules on open, reserved and done-unconfirmed copies (audited); switch on: the job does nothing', () => {
    const f = weekFamily()
    const [mon = 0, tue = 0] = f.day
    must(reserveTask(f.db, f.starsi, tue, MON_10_30, true))
    must(completeTask(f.db, f.starsi, mon, MON_10_30, true))
    job(f, 'weekRules', THU_10)
    expect(drops(f)).toEqual([])
    expect(copiesOf(f.db, f.cat).every((r) => r.weekRules)).toBe(true)

    setWeekPlan(f.db, false)
    const log = job(f, 'weekRules', THU_10)
    const rows = copiesOf(f.db, f.cat)
    expect(rows.map((r) => [r.status, r.weekRules])).toEqual([
      ['done_unconfirmed', false],
      ['reserved', false],
      ['open', false],
      ['open', false],
      ['open', false],
      ['open', false],
      ['open', false],
    ])
    // The day stays, for display.
    expect(rows.every((r) => r.planDayAt !== null)).toBe(true)
    expect(log.info).toHaveBeenCalledWith('[scheduler] week rules dropped: 7')
    const entries = drops(f)
    expect(entries.map((e) => [e.actorKind, e.entityType, e.entityId, e.at])).toEqual(
      f.day.map((id) => ['system', 'task', String(id), THU_10.toISOString()]),
    )
    expect(json(entries[0]?.before)).toEqual({ weekRules: true })
    expect(json(entries[0]?.after)).toEqual({ weekRules: false })
    // A second tick has nothing left to drop.
    job(f, 'weekRules', prague(12, 3, 10, 15))
    expect(drops(f)).toHaveLength(7)
  })

  it('the drop is not a line in the task history', () => {
    const f = weekFamily()
    setWeekPlan(f.db, false)
    dropWeekRules(f.db, THU_10)
    const actions = taskHistory(f.db, f.day[0] ?? 0, String).map((e) => e.action)
    expect(actions).toEqual(['instance.created'])
  })

  it('on → done → off → on → giver rejects: the copy is back reserved under the old rules and does not expire at midnight', () => {
    const f = weekFamily()
    const thursday = f.day[3] ?? 0
    must(reserveTask(f.db, f.starsi, thursday, THU_10, true))
    must(completeTask(f.db, f.starsi, thursday, THU_10, true))
    setWeekPlan(f.db, false)
    job(f, 'weekRules', prague(12, 3, 10, 15))
    setWeekPlan(f.db, true)
    must(rejectTask(f.db, f.tata, thursday, 'Ještě jednou.', prague(12, 3, 11)))
    expect(row(f.db, thursday)).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
      weekRules: false,
    })
    job(f, 'expiry', prague(12, 4, 0, 5))
    expect(row(f.db, thursday)?.status).toBe('reserved')
  })

  it("on → off → on: Thursday's copy made Monday can be done on Wednesday and never expires at midnight after the second flip on", () => {
    const f = weekFamily()
    setWeekPlan(f.db, false)
    job(f, 'weekRules', MON_10_30)
    setWeekPlan(f.db, true)
    const thursday = f.day[3] ?? 0
    expect(completeTaskHandler(f.db, f.starsi, { taskId: thursday }, WED_NOON)).toEqual({
      ok: true,
      id: thursday,
      status: 'done_unconfirmed',
    })
    job(f, 'expiry', THU_0005)
    expect(copiesOf(f.db, f.cat).map((r) => r.status)).toEqual([
      'open',
      'open',
      'open',
      'done_unconfirmed',
      'open',
      'open',
      'open',
    ])
  })

  it('a failed audit write leaves week_rules on for that copy, the others still drop', () => {
    const f = weekFamily()
    const broken = f.day[2] ?? 0
    f.db.$client.exec(
      `CREATE TRIGGER fail_drop BEFORE INSERT ON audit_log
       WHEN NEW.action = 'instance.week_rules_dropped' AND NEW.entity_id = '${String(broken)}'
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    setWeekPlan(f.db, false)
    const log = { error: vi.fn() }
    const dropped = dropWeekRules(f.db, THU_10, log)
    expect(dropped).toEqual(f.day.filter((id) => id !== broken))
    expect(row(f.db, broken)?.weekRules).toBe(true)
    expect(log.error).toHaveBeenCalledWith(
      `[scheduler] week rules: task ${String(broken)} failed`,
      expect.anything(),
    )
  })
})
