import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { fromPragueWallTime } from '~/domain/dates'
import { auditLog, tasks, templates } from '~/server/db/schema'
import { takerPoints } from '~/server/points'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { rollPeriods } from '~/server/periods'
import { approveTask, completeTask, rejectTask, reserveTask } from '~/server/tasks/lifecycle'
import type { Family } from '~/server/tasks/testing'
import { T0, T1, T2, failAuditOn, family, json, must, row } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { agreedTemplate } from '~/server/templates/testing'
import {
  createOnDemandInstance,
  listLoggableTemplates,
  logChoicesAt,
  selfLogInstance,
} from './instances'

// "+ Teď" and Zapsat (#38, spec §5.3 origins 2 and 3).

const taskRows = (f: Family) => f.db.select().from(tasks).all()
const auditRows = (f: Family) => f.db.select().from(auditLog).all()

/** An agreed template with a deadline "next day, 7:30", grace 60 min. */
function binsTemplate(f: Family, approvalRequired = true): number {
  const id = must(
    createTemplate(
      f.db,
      f.tata,
      {
        title: 'Vynést koše',
        score: 4,
        approvalRequired,
        schedule: null,
        deadline: { dayOffset: 1, due: { hour: 7, minute: 30 }, graceMinutes: 60 },
      },
      T0,
    ),
  ).id
  must(approveTemplateScore(f.db, f.starsi, id, 4, T0))
  return id
}

function proposedTemplate(f: Family): number {
  return must(
    createTemplate(
      f.db,
      f.tata,
      { title: 'Umýt okna', score: 9, approvalRequired: true, schedule: null, deadline: null },
      T0,
    ),
  ).id
}

const setTemplateScore = (f: Family, id: number, score: number) =>
  f.db.update(templates).set({ score }).where(eq(templates.id, id)).run()

describe('createOnDemandInstance ("+ Teď")', () => {
  it('makes an open instance at the template score, logged instance.created by the giver', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    const before = auditRows(f).length
    const r = must(createOnDemandInstance(f.db, f.tata, tpl, T1))
    expect(r).toMatchObject({
      title: 'Vyndat myčku',
      status: 'open',
      score: 3,
      origin: 'on_demand',
      templateId: tpl,
      dueAt: null,
      graceEndsAt: null,
      createdBy: f.tata,
      createdAt: T1.toISOString(),
    })
    const added = auditRows(f).slice(before)
    expect(added.map((a) => [a.action, a.entityType, a.entityId, a.actorUserId])).toEqual([
      ['instance.created', 'task', String(r.id), f.tata],
    ])
    expect(json(added[0]?.after)).toEqual({
      templateId: tpl,
      origin: 'on_demand',
      status: 'open',
      description: null,
      score: 3,
      dueAt: null,
      graceEndsAt: null,
      approvalRequired: true,
    })
  })

  it('several in the same minute are several instances', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    must(createOnDemandInstance(f.db, f.tata, tpl, T1))
    must(createOnDemandInstance(f.db, f.tata, tpl, T1))
    expect(taskRows(f)).toHaveLength(2)
  })

  it('a deadline template is due by its rule from the tap', () => {
    const f = family()
    const tpl = binsTemplate(f)
    const tuesday6pm = fromPragueWallTime({ year: 2026, month: 11, day: 24, hour: 18, minute: 0 })
    const r = must(createOnDemandInstance(f.db, f.tata, tpl, tuesday6pm))
    expect([r.dueAt, r.graceEndsAt]).toEqual([
      '2026-11-25T06:30:00.000Z',
      '2026-11-25T07:30:00.000Z',
    ])
  })

  it('keeps its score when the template price changes later', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    const old = must(createOnDemandInstance(f.db, f.tata, tpl, T1))
    setTemplateScore(f, tpl, 5)
    const fresh = must(createOnDemandInstance(f.db, f.tata, tpl, T2))
    expect([row(f.db, old.id)?.score, fresh.score]).toEqual([3, 5])
  })

  it('copies the approval flag: Hotovo waits for a parent only when the template says so', () => {
    const f = family()
    const strict = must(createOnDemandInstance(f.db, f.tata, binsTemplate(f, true), T1))
    const loose = must(createOnDemandInstance(f.db, f.tata, binsTemplate(f, false), T1))
    expect([strict.approvalRequired, loose.approvalRequired]).toEqual([true, false])
    expect(must(completeTask(f.db, f.starsi, strict.id, T1)).status).toBe('done_unconfirmed')
    expect(must(completeTask(f.db, f.starsi, loose.id, T1)).status).toBe('confirmed')
  })

  it('only a giver may: a taker and the admin are refused, nothing written', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    const audits = auditRows(f).length
    expect(createOnDemandInstance(f.db, f.starsi, tpl, T1)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(createOnDemandInstance(f.db, f.admin, tpl, T1)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(createOnDemandInstance(f.db, 999, tpl, T1)).toEqual({ ok: false, error: 'not_allowed' })
    expect([taskRows(f).length, auditRows(f).length]).toEqual([0, audits])
  })
})

describe('selfLogInstance (Zapsat)', () => {
  it('is born done, unconfirmed and waiting for a parent, even if the template needs no approval', () => {
    const f = family()
    const tpl = binsTemplate(f, false)
    const before = auditRows(f).length
    const r = must(selfLogInstance(f.db, f.mladsi, tpl, 4, T1))
    expect(r).toMatchObject({
      status: 'done_unconfirmed',
      origin: 'self_logged',
      templateId: tpl,
      score: 4,
      approvalRequired: true,
      completedBy: f.mladsi,
      completedAt: T1.toISOString(),
      earnerId: f.mladsi,
      dueAt: null,
      graceEndsAt: null,
      createdBy: f.mladsi,
    })
    const added = auditRows(f).slice(before)
    expect(added.map((a) => [a.action, a.entityType, a.actorUserId])).toEqual([
      ['instance.self_logged', 'task', f.mladsi],
    ])
    expect(json(added[0]?.after)).toEqual({
      templateId: tpl,
      origin: 'self_logged',
      status: 'done_unconfirmed',
      description: null,
      score: 4,
      dueAt: null,
      graceEndsAt: null,
      completedBy: f.mladsi,
      completedAt: T1.toISOString(),
      earnerId: f.mladsi,
      approvalRequired: true,
    })
  })

  it('approved: the points count for him; rejected: it ends rejected', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    const a = must(selfLogInstance(f.db, f.mladsi, tpl, 3, T1))
    const b = must(selfLogInstance(f.db, f.mladsi, tpl, 3, T1))
    must(approveTask(f.db, f.tata, a.id, T2))
    must(rejectTask(f.db, f.tata, b.id, undefined, T2))
    expect(row(f.db, b.id)?.status).toBe('rejected')
    expect(takerPoints(f.db, T2).takers.find((t) => t.id === f.mladsi)).toMatchObject({
      confirmed: 3,
      pending: 0,
    })
  })

  it('refuses a score the template no longer has, nothing written', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    setTemplateScore(f, tpl, 5)
    const audits = auditRows(f).length
    expect(selfLogInstance(f.db, f.mladsi, tpl, 3, T1)).toEqual({
      ok: false,
      error: 'score_changed',
    })
    expect([taskRows(f).length, auditRows(f).length]).toEqual([0, audits])
    expect(must(selfLogInstance(f.db, f.mladsi, tpl, 5, T1)).score).toBe(5)
  })

  it('refuses while the same chore is on the board, open or reserved, nothing written (Jakub 2026-11-22)', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    const other = binsTemplate(f)
    const open = must(createOnDemandInstance(f.db, f.tata, tpl, T1))
    const audits = auditRows(f).length
    expect(selfLogInstance(f.db, f.mladsi, tpl, 3, T1)).toEqual({
      ok: false,
      error: 'already_open',
    })
    must(reserveTask(f.db, f.starsi, open.id, T1))
    expect(selfLogInstance(f.db, f.mladsi, tpl, 3, T1)).toEqual({
      ok: false,
      error: 'already_open',
    })
    expect([taskRows(f).length, auditRows(f).length]).toEqual([1, audits + 1])
    // Another chore is fine; so is this one once the board copy is done.
    expect(must(selfLogInstance(f.db, f.mladsi, other, 4, T1)).status).toBe('done_unconfirmed')
    must(completeTask(f.db, f.starsi, open.id, T1))
    expect(must(selfLogInstance(f.db, f.mladsi, tpl, 3, T2)).status).toBe('done_unconfirmed')
  })

  it('a pending log does not block another log of the same chore', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    must(selfLogInstance(f.db, f.mladsi, tpl, 3, T1))
    expect(must(selfLogInstance(f.db, f.starsi, tpl, 3, T1)).status).toBe('done_unconfirmed')
  })

  describe('"Kdy?" (Jakub 2026-11-22)', () => {
    // T1 is Tue 17 Nov 12:00 Prague; the week started Sun 15 Nov 11:00 Prague.
    const withWeek = () => {
      const f = family()
      rollPeriods(f.db, new Date('2026-11-15T10:00:00.000Z'), DEFAULT_PERIOD_DEFAULTS)
      return f
    }

    it('yesterday: done at yesterday 18:00, written now', () => {
      const f = withWeek()
      const tpl = agreedTemplate(f)
      const r = must(selfLogInstance(f.db, f.mladsi, tpl, 3, T1, 'yesterday'))
      expect([r.completedAt, r.createdAt]).toEqual(['2026-11-16T17:00:00.000Z', T1.toISOString()])
      const [entry] = auditRows(f).slice(-1)
      expect(entry?.at).toBe(T1.toISOString())
      expect(json(entry?.after)).toMatchObject({ completedAt: '2026-11-16T17:00:00.000Z' })
    })

    it('this morning: today 7:00', () => {
      const f = withWeek()
      const r = must(selfLogInstance(f.db, f.mladsi, agreedTemplate(f), 3, T1, 'this_morning'))
      expect(r.completedAt).toBe('2026-11-17T06:00:00.000Z')
    })

    it('refuses a time before the running week, nothing written', () => {
      const f = family()
      rollPeriods(f.db, new Date('2026-11-17T09:00:00.000Z'), DEFAULT_PERIOD_DEFAULTS)
      const tpl = agreedTemplate(f)
      const audits = auditRows(f).length
      expect(selfLogInstance(f.db, f.mladsi, tpl, 3, T1, 'yesterday')).toEqual({
        ok: false,
        error: 'too_early',
      })
      expect([taskRows(f).length, auditRows(f).length]).toEqual([0, audits])
      expect(logChoicesAt(f.db, T1)).toEqual(['now'])
    })

    it('offers the choices of the running week', () => {
      expect(logChoicesAt(withWeek().db, T1)).toEqual(['now', 'this_morning', 'yesterday'])
      expect(logChoicesAt(family().db, T1)).toEqual(['now'])
    })
  })

  it('only a taker may: a giver and the admin are refused, nothing written', () => {
    const f = family()
    const tpl = agreedTemplate(f)
    const audits = auditRows(f).length
    expect(selfLogInstance(f.db, f.tata, tpl, 3, T1)).toEqual({ ok: false, error: 'not_a_taker' })
    expect(selfLogInstance(f.db, f.admin, tpl, 3, T1)).toEqual({ ok: false, error: 'not_a_taker' })
    expect([taskRows(f).length, auditRows(f).length]).toEqual([0, audits])
  })
})

describe('both actions', () => {
  it.each([
    [
      'createOnDemandInstance',
      (f: Family, id: number) => createOnDemandInstance(f.db, f.tata, id, T1),
    ],
    ['selfLogInstance', (f: Family, id: number) => selfLogInstance(f.db, f.mladsi, id, 9, T1)],
  ])('%s refuses a proposed template and an unknown one, nothing written', (_, act) => {
    const f = family()
    const proposed = proposedTemplate(f)
    const audits = auditRows(f).length
    expect(act(f, proposed)).toEqual({ ok: false, error: 'not_agreed' })
    expect(act(f, 999)).toEqual({ ok: false, error: 'not_found' })
    expect([taskRows(f).length, auditRows(f).length]).toEqual([0, audits])
  })

  it.each([
    ['instance.created', (f: Family, id: number) => createOnDemandInstance(f.db, f.tata, id, T1)],
    ['instance.self_logged', (f: Family, id: number) => selfLogInstance(f.db, f.mladsi, id, 3, T1)],
  ])('roll back when the %s audit entry fails', (action, act) => {
    const f = family()
    const tpl = agreedTemplate(f)
    failAuditOn(f.db, action)
    expect(() => act(f, tpl)).toThrow(/audit down/)
    expect(taskRows(f)).toHaveLength(0)
  })
})

describe('listLoggableTemplates', () => {
  it('active templates only, by Czech title', () => {
    const f = family()
    proposedTemplate(f)
    for (const title of ['Čistit boty', 'Cvičit na klavír']) {
      const id = must(
        createTemplate(
          f.db,
          f.tata,
          { title, score: 2, approvalRequired: true, schedule: null, deadline: null },
          T0,
        ),
      ).id
      must(approveTemplateScore(f.db, f.starsi, id, 2, T0))
    }
    const dishes = agreedTemplate(f)
    expect(listLoggableTemplates(f.db)).toEqual([
      { id: expect.any(Number) as number, title: 'Cvičit na klavír', score: 2, onBoard: false },
      { id: expect.any(Number) as number, title: 'Čistit boty', score: 2, onBoard: false },
      { id: dishes, title: 'Vyndat myčku', score: 3, onBoard: false },
    ])
    // A copy on the board (open or reserved) marks the tile; a pending one does not.
    must(selfLogInstance(f.db, f.mladsi, dishes, 3, T1))
    expect(listLoggableTemplates(f.db).find((t) => t.id === dishes)?.onBoard).toBe(false)
    must(createOnDemandInstance(f.db, f.tata, dishes, T1))
    expect(listLoggableTemplates(f.db).find((t) => t.id === dishes)?.onBoard).toBe(true)
  })
})
