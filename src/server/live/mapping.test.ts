import { desc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS, writeAudit } from '~/server/audit'
import type { AuditAction, AuditEntry, AuditLogRow } from '~/server/audit'
import type { EntityType } from '~/server/audit/actions'
import {
  auditLog,
  disputes,
  pointAdjustments,
  settlementCorrections,
  settlements,
  suggestions,
  templates,
} from '~/server/db/schema'
import type { DisputeRow } from '~/server/db/schema'
import { adjustment, doneTask, MEETING, reservedTask, SAT, week } from '~/server/settlement/testing'
import { rawTask, T0 } from '~/server/tasks/testing'
import { MAPPED, topicsOf } from './mapping'
import { isTopic } from './topics'

// Audit entry → topics (#299): the table in the plan, pinned with real rows.

type F = ReturnType<typeof week>

/** Writes one entry through the real writer and returns its row. */
function log(f: F, e: Partial<AuditEntry> & { action: AuditAction; entityType: EntityType }) {
  f.db.transaction((tx) => {
    writeAudit(tx, { actor: { kind: 'user', userId: f.tata }, entityId: 1, at: T0, ...e })
  })
  const row = f.db.select().from(auditLog).orderBy(desc(auditLog.id)).get()
  if (!row) throw new Error('no row')
  return row
}

const of = (f: F, row: AuditLogRow) => topicsOf(f.db, row)

function template(f: F, status: 'proposed' | 'active'): number {
  return f.db
    .insert(templates)
    .values({
      title: 'Vynést koše',
      status,
      score: 5,
      approvalRequired: true,
      createdBy: f.tata,
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    })
    .returning()
    .get().id
}

function settlement(f: F, takerId: number): number {
  return f.db
    .insert(settlements)
    .values({
      periodId: f.p1.id,
      takerId,
      totalBefore: 60,
      level: 'lower',
      deducted: 50,
      carryOver: 10,
      settledBy: f.tata,
      settledAt: MEETING.toISOString(),
    })
    .returning()
    .get().id
}

function dispute(f: F, itemKind: DisputeRow['itemKind'], itemId: number, openedBy = f.tata) {
  return f.db
    .insert(disputes)
    .values({
      itemKind,
      itemId,
      openedBy,
      reason: 'Nesouhlasím.',
      openedAt: MEETING.toISOString(),
      status: 'open',
    })
    .returning()
    .get().id
}

const ENTITY: Record<string, EntityType> = {
  task: 'task',
  instance: 'task',
  template: 'template',
  period: 'period',
  defaults: 'defaults_proposal',
  settlement: 'settlement',
  points: 'adjustment',
  dispute: 'dispute',
  user: 'user',
  settings: 'settings',
  suggestion: 'suggestion',
  auth: 'user',
  passkey: 'passkey',
  feature: 'feature',
}
const entityFor = (a: AuditAction): EntityType => {
  const e = ENTITY[a.slice(0, a.indexOf('.'))]
  if (!e) throw new Error(a)
  return a.startsWith('period.proposal_') ? 'period_proposal' : e
}

describe('the mapping table', () => {
  it('every action in AUDIT_ACTIONS has a row in the mapping table', () => {
    expect(Object.keys(MAPPED).sort()).toEqual([...AUDIT_ACTIONS].sort())
  })

  it('every mapped action names topics even when its entity is gone; every none names none', () => {
    const f = week()
    for (const action of AUDIT_ACTIONS) {
      const row = log(f, { action, entityType: entityFor(action), entityId: 999 })
      const topics = of(f, row)
      if (MAPPED[action] === 'topics') expect(topics, action).not.toEqual([])
      else expect(topics, action).toEqual([])
    }
  })

  it('topics are deduplicated and every one passes isTopic', () => {
    const f = week()
    const id = doneTask(f, { score: 5, completedAt: SAT, earner: f.starsi })
    const row = log(f, {
      action: 'task.approved',
      entityType: 'task',
      entityId: id,
      before: { reservedBy: f.starsi },
      after: { earnerId: f.starsi },
    })
    const topics = of(f, row)
    expect(new Set(topics).size).toBe(topics.length)
    for (const t of topics) expect(isTopic(t), t).toBe(true)
  })
})

describe('tasks and copies', () => {
  it('task.released by starsi on a task fires points:<starsi> from before.reservedBy', () => {
    const f = week()
    const id = rawTask(f) // no taker on the row any more
    const row = log(f, {
      action: 'task.released',
      entityType: 'task',
      entityId: id,
      actor: { kind: 'user', userId: f.starsi },
      before: { reservedBy: f.starsi },
      after: { reservedBy: null },
    })
    expect(of(f, row)).toEqual([`points:${f.starsi}`, `task:${id}`, 'tasks', 'week'].sort())
  })

  it('a task reserved by mladsi fires his points from the row', () => {
    const f = week()
    const id = reservedTask(f, f.mladsi, 4)
    const row = log(f, { action: 'task.reserved', entityType: 'task', entityId: id })
    expect(of(f, row)).toEqual([`points:${f.mladsi}`, `task:${id}`, 'tasks', 'week'].sort())
  })

  it('a confirmed task fires the earner (row and after.earnerId)', () => {
    const f = week()
    const id = doneTask(f, { score: 5, completedAt: SAT, earner: f.starsi })
    const row = log(f, {
      action: 'task.approved',
      entityType: 'task',
      entityId: id,
      after: { earnerId: f.mladsi },
    })
    expect(of(f, row)).toEqual(
      [`points:${f.starsi}`, `points:${f.mladsi}`, `task:${id}`, 'tasks', 'week'].sort(),
    )
  })

  it("a copy's entry fires its template too", () => {
    const f = week()
    const tpl = template(f, 'active')
    const id = rawTask(f)
    f.db.$client
      .prepare("update tasks set template_id = ?, origin = 'scheduled' where id = ?")
      .run(tpl, id)
    const row = log(f, { action: 'instance.expired', entityType: 'task', entityId: id })
    expect(of(f, row)).toEqual([`task:${id}`, `template:${tpl}`, 'tasks', 'week'].sort())
  })
})

describe('templates', () => {
  it("a proposed template's change fires templates:proposed, never templates", () => {
    const f = week()
    const id = template(f, 'proposed')
    const row = log(f, { action: 'template.bid_placed', entityType: 'template', entityId: id })
    expect(of(f, row)).toEqual([`template:${id}`, 'templates:proposed'])
  })

  it('an agreed template fires templates', () => {
    const f = week()
    const id = template(f, 'active')
    const row = log(f, { action: 'template.updated', entityType: 'template', entityId: id })
    expect(of(f, row)).toEqual([`template:${id}`, 'templates'])
  })

  it('template.agreed on a template that was proposed (before.status) fires templates:proposed', () => {
    const f = week()
    const id = template(f, 'active')
    const row = log(f, {
      action: 'template.agreed',
      entityType: 'template',
      entityId: id,
      before: { status: 'proposed' },
      after: { status: 'active' },
    })
    expect(of(f, row)).toEqual(
      [`template:${id}`, 'tasks', 'templates', 'templates:proposed'].sort(),
    )
  })

  it('an entry from before the agreement stays templates:proposed when replayed later', () => {
    const f = week()
    const id = template(f, 'active')
    const bid = log(f, { action: 'template.bid_placed', entityType: 'template', entityId: id })
    log(f, {
      action: 'template.agreed',
      entityType: 'template',
      entityId: id,
      before: { status: 'proposed' },
    })
    const later = log(f, { action: 'template.updated', entityType: 'template', entityId: id })
    expect(of(f, bid)).toEqual([`template:${id}`, 'templates:proposed'])
    expect(of(f, later)).toEqual([`template:${id}`, 'templates'])
  })

  it('template.cancelled fires tasks', () => {
    const f = week()
    const id = template(f, 'active')
    const row = log(f, { action: 'template.cancelled', entityType: 'template', entityId: id })
    expect(of(f, row)).toEqual([`template:${id}`, 'tasks', 'templates'].sort())
  })
})

describe('periods, proposals, settings and people', () => {
  it.each(['period.created', 'period.ended'] as const)('%s fires week, proposals, tasks', (a) => {
    const f = week()
    const row = log(f, { action: a, entityType: 'period', entityId: f.p1.id })
    expect(of(f, row)).toEqual(['proposals', 'tasks', 'week'])
  })

  it.each([
    ['period.proposal_agreed', 'period_proposal'],
    ['period.proposal_lapsed', 'period_proposal'],
    ['defaults.proposal_created', 'defaults_proposal'],
  ] as const)('%s fires proposals, week', (action, entityType) => {
    const f = week()
    const row = log(f, { action, entityType, entityId: 1 })
    expect(of(f, row)).toEqual(['proposals', 'week'])
  })

  it('settings.changed fires settings, week', () => {
    const f = week()
    const row = log(f, { action: 'settings.changed', entityType: 'settings', entityId: 1 })
    expect(of(f, row)).toEqual(['settings', 'week'])
  })

  it.each(['user.created', 'user.updated'] as const)('%s fires people', (action) => {
    const f = week()
    const row = log(f, { action, entityType: 'user', entityId: f.starsi })
    expect(of(f, row)).toEqual(['people'])
  })
})

describe('settlement and points', () => {
  it.each(['settlement.created', 'settlement.corrected'] as const)(
    '%s fires week and the taker',
    (action) => {
      const f = week()
      const id = settlement(f, f.mladsi)
      const row = log(f, { action, entityType: 'settlement', entityId: id })
      expect(of(f, row)).toEqual([`points:${f.mladsi}`, 'week'])
    },
  )

  it('points.adjusted fires week and the taker', () => {
    const f = week()
    const id = adjustment(f, f.starsi, 5, MEETING)
    const row = log(f, { action: 'points.adjusted', entityType: 'adjustment', entityId: id })
    expect(of(f, row)).toEqual([`points:${f.starsi}`, 'week'])
  })
})

describe('disputes', () => {
  it("a dispute about mladsi's settlement opened by tata fires disputes, disputes:by:<tata>, disputes:about:<mladsi>, week, points:<mladsi>", () => {
    const f = week()
    const id = dispute(f, 'settlement', settlement(f, f.mladsi))
    const row = log(f, { action: 'dispute.opened', entityType: 'dispute', entityId: id })
    expect(of(f, row)).toEqual(
      [
        'disputes',
        `disputes:by:${f.tata}`,
        `disputes:about:${f.mladsi}`,
        'week',
        `points:${f.mladsi}`,
      ].sort(),
    )
  })

  it("a dispute on task 12's completion also fires task:12", () => {
    const f = week()
    const task = doneTask(f, { score: 5, completedAt: SAT, earner: f.starsi })
    const id = dispute(f, 'completion', task, f.mladsi)
    const row = log(f, { action: 'dispute.opened', entityType: 'dispute', entityId: id })
    expect(of(f, row)).toEqual(
      ['disputes', `disputes:about:${f.starsi}`, `disputes:by:${f.mladsi}`, `task:${task}`].sort(),
    )
  })

  it('a task score dispute is about nobody: disputes:about:none', () => {
    const f = week()
    const task = rawTask(f)
    const id = dispute(f, 'task_score', task, f.starsi)
    const row = log(f, { action: 'dispute.dismissed', entityType: 'dispute', entityId: id })
    expect(of(f, row)).toEqual(
      ['disputes', 'disputes:about:none', `disputes:by:${f.starsi}`, `task:${task}`].sort(),
    )
  })

  it("on template 4's score also fires template:4", () => {
    const f = week()
    const tpl = template(f, 'active')
    const id = dispute(f, 'template_score', tpl)
    const row = log(f, { action: 'dispute.opened', entityType: 'dispute', entityId: id })
    expect(of(f, row)).toEqual(
      ['disputes', 'disputes:about:none', `disputes:by:${f.tata}`, `template:${tpl}`].sort(),
    )
  })

  it('an adjustment dispute fires week and the taker', () => {
    const f = week()
    const id = dispute(f, 'adjustment', adjustment(f, f.starsi, -3, MEETING))
    const row = log(f, { action: 'dispute.opened', entityType: 'dispute', entityId: id })
    expect(of(f, row)).toEqual(
      [
        'disputes',
        `disputes:about:${f.starsi}`,
        `disputes:by:${f.tata}`,
        `points:${f.starsi}`,
        'week',
      ].sort(),
    )
  })

  it("dispute.corrected adds the corrected taker's points and week (adjustment link)", () => {
    const f = week()
    const tpl = template(f, 'active')
    const id = dispute(f, 'template_score', tpl)
    const adj = adjustment(f, f.mladsi, 2, MEETING)
    const row = log(f, {
      action: 'dispute.corrected',
      entityType: 'dispute',
      entityId: id,
      after: { status: 'corrected', correction: { kind: 'adjustment', id: adj } },
    })
    expect(of(f, row)).toEqual(
      [
        'disputes',
        'disputes:about:none',
        `disputes:by:${f.tata}`,
        `template:${tpl}`,
        'week',
        `points:${f.mladsi}`,
      ].sort(),
    )
  })

  it("dispute.corrected through a settlement correction fires that settlement's taker", () => {
    const f = week()
    const s = settlement(f, f.starsi)
    const id = dispute(f, 'settlement', s, f.mladsi)
    const correction = f.db
      .insert(settlementCorrections)
      .values({
        settlementId: s,
        level: 'none',
        deducted: 0,
        reason: 'Chyba.',
        madeBy: f.admin,
        madeAt: MEETING.toISOString(),
      })
      .returning()
      .get().id
    const row = log(f, {
      action: 'dispute.corrected',
      entityType: 'dispute',
      entityId: id,
      after: { correction: { kind: 'settlement_correction', id: correction } },
    })
    expect(of(f, row)).toEqual(
      [
        'disputes',
        `disputes:about:${f.starsi}`,
        `disputes:by:${f.mladsi}`,
        `points:${f.starsi}`,
        'week',
      ].sort(),
    )
    expect(f.db.select().from(pointAdjustments).all()).toEqual([])
  })
})

describe('suggestions', () => {
  it.each(['suggestion.created', 'suggestion.sent', 'suggestion.done'] as const)(
    '%s fires suggestions and its author',
    (action) => {
      const f = week()
      const id = f.db
        .insert(suggestions)
        .values({ authorId: f.starsi, title: 'T', createdAt: T0.toISOString(), status: 'new' })
        .returning()
        .get().id
      const row = log(f, { action, entityType: 'suggestion', entityId: id })
      expect(of(f, row)).toEqual(['suggestions', `suggestions:by:${f.starsi}`])
    },
  )
})

describe('out of scope', () => {
  it.each([
    ['auth.login_succeeded', 'session'],
    ['auth.logout', 'session'],
    ['passkey.registered', 'passkey'],
    ['feature.switched', 'feature'],
    ['settings.changed', 'app_meta'],
  ] as const)('%s on %s maps to no topics', (action, entityType) => {
    const f = week()
    expect(of(f, log(f, { action, entityType, entityId: 1 }))).toEqual([])
  })
})

describe('gone targets', () => {
  it('topicsOf on a row whose target is gone returns the topics it can still name, never throws', () => {
    const f = week()
    // A dispute naming a task that does not exist (no foreign key on item_id).
    const id = dispute(f, 'completion', 4242)
    const row = log(f, { action: 'dispute.opened', entityType: 'dispute', entityId: id })
    expect(of(f, row)).toEqual(['disputes', `disputes:by:${f.tata}`])
    const task = log(f, { action: 'task.completed', entityType: 'task', entityId: 4242 })
    expect(of(f, task)).toEqual(['task:4242', 'tasks', 'week'])
    const tpl = log(f, { action: 'template.updated', entityType: 'template', entityId: 4242 })
    expect(of(f, tpl)).toEqual(['template:4242', 'templates:proposed'])
  })
})
