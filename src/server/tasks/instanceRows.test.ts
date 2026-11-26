import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { writeAudit } from '~/server/audit'
import { auditLog, tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { takerPoints } from '~/server/points'
import { agreedTemplate } from '~/server/templates/testing'
import { columnsOf, toItem } from './item'
import { approveTask, completeTask, rejectTask } from './lifecycle'
import { rejectionsSince } from './rejections'
import { proposeTaskScoreChange } from './scoreChange'
import { getTaskDetail, listBoard, listPendingCompletions } from './tasks'
import type { Family } from './testing'
import { T0, T1, T2, T3, car, family, must, row } from './testing'

// Instance rows (#38) go through the one-time task code unchanged: the mapping to the domain,
// the lifecycle steps, the views and the reads of the audit log.

const iso = (d: Date) => d.toISOString()

/** An instance row written directly, as the instance module (#38 Task 4) will write it. */
function instance(f: Family, values: Partial<typeof tasks.$inferInsert>): TaskRow {
  return f.db
    .insert(tasks)
    .values({
      title: 'Vyndat myčku',
      status: 'open',
      score: 3,
      approvalRequired: true,
      createdBy: f.tata,
      createdAt: iso(T0),
      updatedAt: iso(T0),
      agreedAt: iso(T0),
      templateId: agreedTemplate(f),
      origin: 'on_demand',
      ...values,
    })
    .returning()
    .get()
}

/** Mladší's self-log of "Vyndat myčku" at T1, waiting for a giver. */
const selfLogged = (f: Family) =>
  instance(f, {
    origin: 'self_logged',
    status: 'done_unconfirmed',
    completedBy: f.mladsi,
    completedAt: iso(T1),
    earnerId: f.mladsi,
  })

describe('toItem / columnsOf on instances', () => {
  it('a rejected self-log round-trips with its completion', () => {
    const f = family()
    const r = selfLogged(f)
    must(rejectTask(f.db, f.tata, r.id, undefined, T2))
    const rejected = row(f.db, r.id)
    if (!rejected) throw new Error('missing row')
    const item = toItem(rejected, false)
    expect(item).toMatchObject({
      origin: 'self_logged',
      status: 'rejected',
      completion: { completedBy: f.mladsi, earner: f.mladsi, completedAt: T1 },
    })
    expect(columnsOf(item)).toMatchObject({
      status: 'rejected',
      completedBy: f.mladsi,
      completedAt: iso(T1),
      earnerId: f.mladsi,
    })
  })

  it('an expired instance maps both ways with no reservation or completion', () => {
    const f = family()
    const r = instance(f, { status: 'expired' })
    const item = toItem(r, false)
    expect(item.status).toBe('expired')
    expect(columnsOf(item)).toMatchObject({
      status: 'expired',
      reservedBy: null,
      completedBy: null,
    })
  })

  it('an on-demand row with a deadline gives the deadline as dates', () => {
    const f = family()
    const r = instance(f, { dueAt: iso(T2), graceEndsAt: iso(T3) })
    expect(toItem(r, false)).toMatchObject({
      origin: 'on_demand',
      deadline: { dueAt: T2, graceEndsAt: T3 },
    })
  })

  it('a one-time task stays one_time with no deadline', () => {
    const f = family()
    const r = row(f.db, car(f))
    if (!r) throw new Error('missing row')
    expect(toItem(r, false)).toMatchObject({ origin: 'one_time', deadline: null })
  })

  it('a week copy has its day only with dayRules and week_rules both on (#257)', () => {
    const f = family()
    const planDayAt = '2026-12-02T23:00:00.000Z'
    const day = {
      startsAt: new Date(planDayAt),
      endsAt: new Date('2026-12-03T23:00:00.000Z'),
    }
    const marked = instance(f, { planDayAt, weekRules: true })
    expect(toItem(marked, true).day).toEqual(day)
    expect(toItem(marked, false).day).toBeNull()
    expect(toItem(instance(f, { planDayAt, weekRules: false }), true).day).toBeNull()
    expect(toItem(instance(f, {}), true).day).toBeNull()
  })
})

describe('lifecycle on instances', () => {
  it('Hotovo is refused from the end of grace on, allowed 1 ms before', () => {
    const f = family()
    const late = instance(f, { dueAt: iso(T1), graceEndsAt: iso(T2) })
    expect(completeTask(f.db, f.starsi, late.id, T2)).toEqual({ ok: false, error: 'past_grace' })
    const inTime = instance(f, { dueAt: iso(T1), graceEndsAt: iso(T2) })
    const done = must(completeTask(f.db, f.starsi, inTime.id, new Date(T2.getTime() - 1)))
    expect(done.status).toBe('done_unconfirmed')
  })

  it('a rejected self-log is closed: no points, not pending, not on the board', () => {
    const f = family()
    const r = selfLogged(f)
    const before = takerPoints(f.db, T2).takers.find((t) => t.id === f.mladsi)
    expect(before?.pending).toBe(3)
    must(rejectTask(f.db, f.tata, r.id, undefined, T2))
    const saved = row(f.db, r.id)
    expect(saved).toMatchObject({ status: 'rejected', earnerId: f.mladsi })
    expect(takerPoints(f.db, T2).takers.find((t) => t.id === f.mladsi)).toMatchObject({
      confirmed: 0,
      pending: 0,
    })
    expect(listPendingCompletions(f.db).map((t) => t.id)).not.toContain(r.id)
    expect(listBoard(f.db).map((t) => t.id)).not.toContain(r.id)
  })

  it('an approved self-log counts its points for the taker', () => {
    const f = family()
    const r = selfLogged(f)
    must(approveTask(f.db, f.tata, r.id, T2))
    expect(takerPoints(f.db, T2).takers.find((t) => t.id === f.mladsi)?.confirmed).toBe(3)
  })

  it('an instance never takes a price change, and nothing is logged', () => {
    const f = family()
    const r = instance(f, {})
    const audits = f.db.select().from(auditLog).all().length
    expect(proposeTaskScoreChange(f.db, f.starsi, r.id, 5, T1)).toEqual({
      ok: false,
      error: 'not_changeable',
    })
    expect(f.db.select().from(auditLog).all()).toHaveLength(audits)
  })
})

describe('views and audit reads of instances', () => {
  it('the task view carries origin, template and deadline', () => {
    const f = family()
    const r = instance(f, { dueAt: iso(T2), graceEndsAt: iso(T3) })
    expect(getTaskDetail(f.db, r.id)?.task).toMatchObject({
      origin: 'on_demand',
      templateId: r.templateId,
      dueAt: iso(T2),
      graceEndsAt: iso(T3),
    })
  })

  it('the history shows the self-log with its score', () => {
    const f = family()
    const r = selfLogged(f)
    f.db.transaction((tx) => {
      writeAudit(tx, {
        actor: { kind: 'user', userId: f.mladsi },
        action: 'instance.self_logged',
        entityType: 'task',
        entityId: r.id,
        after: { score: 3 },
        at: T1,
      })
    })
    expect(getTaskDetail(f.db, r.id)?.history.map((h) => [h.action, h.by?.name, h.score])).toEqual([
      ['instance.self_logged', 'Mladší', 3],
    ])
  })

  it('a rejected self-log is a closed rejection, a rejected one-time task is not', () => {
    const f = family()
    const log = selfLogged(f)
    must(rejectTask(f.db, f.tata, log.id, undefined, T2))
    // The one-time task: reserved, done and rejected back to Starší.
    const id = car(f)
    f.db
      .update(tasks)
      .set({ status: 'reserved', reservedBy: f.starsi, reservedVia: 'tap', agreedAt: iso(T0) })
      .where(eq(tasks.id, id))
      .run()
    must(completeTask(f.db, f.starsi, id, T2))
    must(rejectTask(f.db, f.tata, id, 'ještě ne', T3))
    expect(rejectionsSince(f.db, T0).map((r) => [r.taskId, r.closed])).toEqual([
      [id, false],
      [log.id, true],
    ])
  })
})
