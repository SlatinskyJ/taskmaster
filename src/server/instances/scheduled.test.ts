import { asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { ClockTime, DeadlineRule } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { fromPragueWallTime } from '~/domain/dates'
import { auditLog, tasks, templateSlots } from '~/server/db/schema'
import { takerPoints } from '~/server/points'
import { completeTask, reserveTask } from '~/server/tasks/lifecycle'
import type { Family } from '~/server/tasks/testing'
import { T0, family, json, must } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { createOnDemandInstance } from './instances'
import { createScheduledInstances } from './scheduled'

// Scheduled instances (#39, spec §5.3 origin 1): one per schedule slot, made by the system.

const prague = (month: number, day: number, hour: number, minute = 0) =>
  fromPragueWallTime({ year: 2026, month, day, hour, minute })

const TUE_17 = prague(11, 17, 18)
const MON_23 = prague(11, 23, 10)
const TUE_24 = prague(11, 24, 18)
const TUE_1 = prague(12, 1, 18)
const TUE = 2 as Weekday
const SIX_PM: ClockTime = { hour: 18, minute: 0 }
/** "next day, 7:00", grace 60 min. */
const NEXT_MORNING: DeadlineRule = { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 60 }

function scheduled(
  f: Family,
  opts: { title?: string; deadline?: DeadlineRule | null; agreedAt?: Date; days?: Weekday[] } = {},
): number {
  const id = must(
    createTemplate(
      f.db,
      f.tata,
      {
        title: opts.title ?? 'Vynést koše',
        score: 4,
        approvalRequired: false,
        schedule: { days: opts.days ?? [TUE], time: SIX_PM },
        deadline: opts.deadline ?? null,
      },
      T0,
    ),
  ).id
  must(approveTemplateScore(f.db, f.starsi, id, 4, opts.agreedAt ?? MON_23))
  return id
}

const rowsOf = (f: Family, templateId: number) =>
  f.db.select().from(tasks).where(eq(tasks.templateId, templateId)).orderBy(asc(tasks.id)).all()

const lastSlot = (f: Family, templateId: number) =>
  f.db.select().from(templateSlots).where(eq(templateSlots.templateId, templateId)).get()
    ?.lastSlotAt

const auditsOf = (f: Family, taskId: number) =>
  f.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, String(taskId)))
    .orderBy(asc(auditLog.id))
    .all()
    .filter((a) => a.entityType === 'task')

const run = (f: Family, at: Date) => createScheduledInstances(f.db, at, { error: vi.fn() })

describe('createScheduledInstances', () => {
  it('makes one open instance at the slot, born from the template, logged by the system', () => {
    const f = family()
    const tpl = scheduled(f)
    const [made, ...more] = run(f, TUE_24)
    expect(more).toEqual([])
    expect(made).toMatchObject({
      title: 'Vynést koše',
      score: 4,
      approvalRequired: false,
      status: 'open',
      origin: 'scheduled',
      templateId: tpl,
      dueAt: null,
      graceEndsAt: null,
      createdBy: f.tata,
      createdAt: TUE_24.toISOString(),
    })
    const audits = auditsOf(f, made?.id ?? 0)
    expect(audits.map((a) => [a.action, a.actorKind, a.actorUserId])).toEqual([
      ['instance.created', 'system', null],
    ])
    expect(json(audits[0]?.after)).toMatchObject({
      origin: 'scheduled',
      templateId: tpl,
      slotAt: TUE_24.toISOString(),
    })
  })

  it('a slot makes one instance however many ticks see it', () => {
    const f = family()
    const plain = scheduled(f)
    const due = scheduled(f, { title: 'Nakrmit rybičky', deadline: NEXT_MORNING })
    run(f, TUE_24)
    expect(run(f, TUE_24)).toEqual([])
    expect(run(f, prague(11, 24, 18, 1))).toEqual([])
    expect([rowsOf(f, plain).length, rowsOf(f, due).length]).toEqual([1, 1])
    expect(lastSlot(f, plain)).toBe(TUE_24.toISOString())
  })

  it('no duplicate: a slot is skipped while an instance is still open, and counts as handled', () => {
    const f = family()
    const tpl = scheduled(f)
    const [first] = run(f, TUE_24)
    expect(run(f, TUE_1)).toEqual([])
    expect(lastSlot(f, tpl)).toBe(TUE_1.toISOString())
    must(completeTask(f.db, f.tata, first?.id ?? 0, prague(12, 1, 19)))
    expect(run(f, prague(12, 1, 20))).toEqual([])
    expect(run(f, prague(12, 8, 18))).toHaveLength(1)
  })

  it.each([
    ['reserved', 0],
    ['done, unconfirmed', 1],
  ] as const)('an earlier instance %s → %i new rows', (state, count) => {
    const f = family()
    const tpl = must(
      createTemplate(
        f.db,
        f.tata,
        {
          title: 'Vynést koše',
          score: 4,
          approvalRequired: true,
          schedule: { days: [TUE], time: SIX_PM },
          deadline: null,
        },
        T0,
      ),
    ).id
    must(approveTemplateScore(f.db, f.starsi, tpl, 4, MON_23))
    const [first] = run(f, TUE_24)
    const id = first?.id ?? 0
    must(reserveTask(f.db, f.starsi, id, TUE_24))
    if (state === 'done, unconfirmed') must(completeTask(f.db, f.starsi, id, TUE_24))
    expect(run(f, TUE_1)).toHaveLength(count)
  })

  it('an open on-demand instance blocks too; one of another template does not', () => {
    const f = family()
    const tpl = scheduled(f)
    const other = scheduled(f, { title: 'Zamést chodbu' })
    must(createOnDemandInstance(f.db, f.tata, tpl, MON_23))
    const made = run(f, TUE_24)
    expect(made.map((r) => r.templateId)).toEqual([other])
  })

  it('a deadline instance is due by its rule from the slot, even when the tick is late', () => {
    const f = family()
    const tpl = scheduled(f, { deadline: NEXT_MORNING })
    const [onTime] = run(f, TUE_24)
    expect([onTime?.dueAt, onTime?.graceEndsAt]).toEqual([
      '2026-11-25T06:00:00.000Z',
      '2026-11-25T07:00:00.000Z',
    ])
    const [second] = run(f, TUE_1)
    expect(second?.status).toBe('open')
    expect(rowsOf(f, tpl)).toHaveLength(2)

    const g = family()
    scheduled(g, { deadline: NEXT_MORNING })
    const [late] = run(g, prague(11, 25, 6, 30))
    expect([late?.createdAt, late?.dueAt]).toEqual([
      TUE_24.toISOString(),
      '2026-11-25T06:00:00.000Z',
    ])
    // Born at the slot, written at the tick: the audit log stays in the order things happened.
    const [entry] = auditsOf(g, late?.id ?? 0)
    expect([entry?.at, json(entry?.after)]).toMatchObject([
      prague(11, 25, 6, 30).toISOString(),
      { slotAt: TUE_24.toISOString() },
    ])
  })

  it('after downtime only the latest missed slot makes an instance', () => {
    const f = family()
    const tpl = scheduled(f, { agreedAt: prague(11, 16, 10) })
    const [first] = run(f, TUE_17)
    must(completeTask(f.db, f.tata, first?.id ?? 0, TUE_17))
    const made = run(f, prague(12, 2, 12))
    expect(made.map((r) => r.createdAt)).toEqual([TUE_1.toISOString()])
    expect(rowsOf(f, tpl)).toHaveLength(2)
  })

  it('a slot whose grace has ended is made and expired in the same tick', () => {
    const graceEnd = new Date('2026-11-25T07:00:00.000Z')
    const f = family()
    scheduled(f, { deadline: NEXT_MORNING })
    expect(run(f, new Date(graceEnd.getTime() - 1))[0]?.status).toBe('open')
    const g = family()
    scheduled(g, { deadline: NEXT_MORNING })
    expect(run(g, graceEnd)[0]?.status).toBe('expired')
  })

  it('a long outage: the missed deadline slot is born expired, both steps by the system, no points', () => {
    const f = family()
    scheduled(f, { deadline: NEXT_MORNING, agreedAt: prague(11, 16, 10) })
    const [first] = run(f, TUE_17)
    must(completeTask(f.db, f.starsi, first?.id ?? 0, TUE_17))
    const [made, ...more] = run(f, prague(12, 3, 9))
    expect(more).toEqual([])
    expect([made?.createdAt, made?.status]).toEqual([TUE_1.toISOString(), 'expired'])
    expect(auditsOf(f, made?.id ?? 0).map((a) => [a.action, a.actorKind])).toEqual([
      ['instance.created', 'system'],
      ['instance.expired', 'system'],
    ])
    const points = takerPoints(f.db, TUE_24).takers.map((t) => [t.name, t.confirmed, t.pending])
    expect(points).toEqual([
      ['Starší', 4, 0],
      ['Mladší', 0, 0],
    ])
  })

  it('slots before the template was agreed make nothing', () => {
    const f = family()
    const tpl = scheduled(f, { agreedAt: prague(11, 24, 19) })
    expect(run(f, prague(11, 24, 19, 1))).toEqual([])
    expect(run(f, TUE_1)).toHaveLength(1)
    expect(rowsOf(f, tpl)).toHaveLength(1)
  })

  it('a proposed template and one with no schedule never make an instance', () => {
    const f = family()
    must(
      createTemplate(
        f.db,
        f.tata,
        {
          title: 'Umýt okna',
          score: 9,
          approvalRequired: true,
          schedule: { days: [TUE], time: SIX_PM },
          deadline: null,
        },
        T0,
      ),
    )
    const free = must(
      createTemplate(
        f.db,
        f.tata,
        { title: 'Vyndat myčku', score: 3, approvalRequired: true, schedule: null, deadline: null },
        T0,
      ),
    ).id
    must(approveTemplateScore(f.db, f.starsi, free, 3, MON_23))
    expect(run(f, TUE_24)).toEqual([])
    expect(f.db.select().from(tasks).all()).toEqual([])
  })

  it('one failing template is logged and rolled back; the next one still gets its row', () => {
    const f = family()
    const broken = scheduled(f)
    const fine = scheduled(f, { title: 'Zamést chodbu' })
    f.db.$client.exec(
      `CREATE TRIGGER fail_one BEFORE INSERT ON audit_log
       WHEN NEW.action = 'instance.created'
         AND json_extract(NEW.after, '$.templateId') = ${String(broken)}
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    const log = { error: vi.fn() }
    const made = createScheduledInstances(f.db, TUE_24, log)
    expect(made.map((r) => r.templateId)).toEqual([fine])
    expect([rowsOf(f, broken).length, lastSlot(f, broken)]).toEqual([0, undefined])
    expect(lastSlot(f, fine)).toBe(TUE_24.toISOString())
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(String(log.error.mock.calls[0]?.[0])).toContain(`template ${String(broken)}`)
  })
})
