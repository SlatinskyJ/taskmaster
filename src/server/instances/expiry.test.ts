import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { AuditAction } from '~/server/audit'
import { auditLog, tasks } from '~/server/db/schema'
import { listPendingCompletions } from '~/server/tasks'
import { cancelTask, completeTask, expireTask, reserveTask } from '~/server/tasks/lifecycle'
import type { Family } from '~/server/tasks/testing'
import { T0, T1, failAuditOn, family, json, must, row } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { agreedTemplate } from '~/server/templates/testing'
import { expireOverdueInstances } from './expiry'
import { createOnDemandInstance } from './instances'

// Expiry (#39, spec §5.3): a deadline instance nobody finished in its grace window expires.

/** "Vynést koše", due next day 7:30 Prague, grace 60 min. Made at T1, grace ends at GRACE_END. */
function binsTemplate(f: Family): number {
  const id = must(
    createTemplate(
      f.db,
      f.tata,
      {
        title: 'Vynést koše',
        score: 4,
        approvalRequired: true,
        schedule: null,
        deadline: { dayOffset: 1, due: { hour: 7, minute: 30 }, graceMinutes: 60 },
      },
      T0,
    ),
  ).id
  must(approveTemplateScore(f.db, f.starsi, id, 4, T0))
  return id
}

const GRACE_END = new Date('2026-11-18T07:30:00.000Z')
const before = (d: Date) => new Date(d.getTime() - 1)

const bins = (f: Family, tpl = binsTemplate(f)) =>
  must(createOnDemandInstance(f.db, f.tata, tpl, T1)).id

const audits = (f: Family, action: AuditAction) =>
  f.db.select().from(auditLog).where(eq(auditLog.action, action)).all()

describe('expireTask', () => {
  it('refuses before the grace window ends; the row is unchanged', () => {
    const f = family()
    const id = bins(f)
    expect(expireTask(f.db, id, before(GRACE_END))).toEqual({ ok: false, error: 'grace_not_over' })
    expect(row(f.db, id)?.status).toBe('open')
    expect(audits(f, 'instance.expired')).toHaveLength(0)
  })

  it('expires an open instance when grace ends, audited by the system', () => {
    const f = family()
    const id = bins(f)
    expect(must(expireTask(f.db, id, GRACE_END)).status).toBe('expired')
    const [entry, ...more] = audits(f, 'instance.expired')
    expect(more).toHaveLength(0)
    expect([entry?.actorKind, entry?.actorUserId, entry?.entityType, entry?.entityId]).toEqual([
      'system',
      null,
      'task',
      String(id),
    ])
    expect(json(entry?.before)).toMatchObject({ status: 'open' })
    expect(json(entry?.after)).toMatchObject({ status: 'expired', accepted: [], closed: [] })
    // Same audit shape as every other lifecycle step (read back by the history).
    must(cancelTask(f.db, f.tata, bins(f), undefined, T1))
    const keys = (v: unknown) => Object.keys(v as object).sort()
    expect(keys(json(entry?.after))).toEqual(keys(json(audits(f, 'task.cancelled')[0]?.after)))
  })

  it('expires a reserved one and clears the reservation', () => {
    const f = family()
    const id = bins(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    const r = must(expireTask(f.db, id, GRACE_END))
    expect([r.status, r.reservedBy]).toEqual(['expired', null])
  })

  it('writes nothing when its audit entry fails', () => {
    const f = family()
    const id = bins(f)
    failAuditOn(f.db, 'instance.expired')
    expect(() => expireTask(f.db, id, GRACE_END)).toThrow(/audit down/)
    expect(row(f.db, id)?.status).toBe('open')
  })
})

describe('expireOverdueInstances', () => {
  it('expires the overdue ones only, once', () => {
    const f = family()
    const tpl = binsTemplate(f)
    const a = bins(f, tpl)
    const b = bins(f, tpl)
    must(reserveTask(f.db, f.mladsi, b, T1))
    const later = must(
      createOnDemandInstance(f.db, f.tata, tpl, new Date('2026-11-18T10:00:00.000Z')),
    ).id
    const pending = bins(f, tpl)
    must(completeTask(f.db, f.starsi, pending, T1))
    const confirmed = bins(f, tpl)
    must(completeTask(f.db, f.tata, confirmed, T1))
    const noDeadline = must(createOnDemandInstance(f.db, f.tata, agreedTemplate(f), T1)).id

    expect(expireOverdueInstances(f.db, GRACE_END)).toEqual([a, b])
    expect(
      [a, b, later, pending, confirmed, noDeadline].map((id) => row(f.db, id)?.status),
    ).toEqual(['expired', 'expired', 'open', 'done_unconfirmed', 'confirmed', 'open'])
    expect(listPendingCompletions(f.db).map((t) => t.id)).toEqual([pending])

    expect(expireOverdueInstances(f.db, GRACE_END)).toEqual([])
    expect(audits(f, 'instance.expired')).toHaveLength(2)
  })

  it('one failure does not stop the rest; it is logged and nothing throws', () => {
    const f = family()
    const tpl = binsTemplate(f)
    const a = bins(f, tpl)
    const b = bins(f, tpl)
    // Fails the first row's entry only.
    f.db.$client.exec(
      `CREATE TRIGGER fail_first BEFORE INSERT ON audit_log
       WHEN NEW.action = 'instance.expired' AND NEW.entity_id = '${String(a)}'
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    const log = { error: vi.fn() }
    expect(expireOverdueInstances(f.db, GRACE_END, log)).toEqual([b])
    expect([row(f.db, a)?.status, row(f.db, b)?.status]).toEqual(['open', 'expired'])
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(String(log.error.mock.calls[0]?.[0])).toContain(`task ${String(a)}`)
  })

  it('leaves rows untouched by status', () => {
    const f = family()
    const id = bins(f)
    f.db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, id)).run()
    expect(expireOverdueInstances(f.db, GRACE_END)).toEqual([])
  })
})
