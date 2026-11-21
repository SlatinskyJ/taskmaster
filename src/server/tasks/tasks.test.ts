import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { auditLog, tasks, taskScoreApprovals, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { updateUser } from '~/server/users/manage'
import { listPeople } from '~/server/users/people'
import {
  approveTaskOffer,
  createTask,
  listTasks,
  pendingApprovals,
  resolveProposedTasks,
  TITLE_MAX,
} from './tasks'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const T1 = new Date('2026-11-17T11:00:00.000Z')
const T2 = new Date('2026-11-17T12:00:00.000Z')

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

/** Admin, Táta (giver) and the two brothers (takers). */
function family() {
  const db = createTestDb()
  const add = (username: string, displayName: string, role: 'admin' | 'giver' | 'taker') =>
    db
      .insert(users)
      .values({
        username,
        displayName,
        role,
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      })
      .returning()
      .get().id
  return {
    db,
    admin: add('admin', 'Admin', 'admin'),
    tata: add('tata', 'Táta', 'giver'),
    starsi: add('starsi', 'Starší', 'taker'),
    mladsi: add('mladsi', 'Mladší', 'taker'),
  }
}

const auditActions = (db: Db, taskId: number) =>
  db
    .select({ action: auditLog.action, actor: auditLog.actorUserId, kind: auditLog.actorKind })
    .from(auditLog)
    .where(eq(auditLog.entityId, String(taskId)))
    .all()

const CAR = { title: 'Umýt auto', score: 18, approvalRequired: true }

describe('createTask (spec §5.2)', () => {
  it('a giver creates a proposed task; the offer counts as the giver approving', () => {
    const { db, tata } = family()
    const task = must(createTask(db, tata, CAR, T0))
    expect(task).toMatchObject({
      title: 'Umýt auto',
      status: 'proposed',
      score: 18,
      agreedAt: null,
    })
    expect(db.select().from(taskScoreApprovals).all()).toEqual([
      { taskId: task.id, userId: tata, offerRound: 1, score: 18, approvedAt: T0.toISOString() },
    ])
    expect(auditActions(db, task.id)).toEqual([
      { action: 'task.created', actor: tata, kind: 'user' },
    ])
  })

  it.each([
    ['taker', 'starsi'],
    ['admin', 'admin'],
  ] as const)('a %s may not create one', (_, who) => {
    const f = family()
    expect(createTask(f.db, f[who], CAR, T0)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(f.db.select().from(tasks).all()).toEqual([])
    expect(f.db.select().from(auditLog).all()).toEqual([])
  })

  it.each([0, -3, 2.5, Number.NaN])('refuses score %s', (score) => {
    const { db, tata } = family()
    expect(createTask(db, tata, { ...CAR, score }, T0)).toEqual({
      ok: false,
      error: 'invalid_score',
    })
  })

  it.each(['', '   ', 'x'.repeat(TITLE_MAX + 1)])('refuses title %j', (title) => {
    const { db, tata } = family()
    expect(createTask(db, tata, { ...CAR, title }, T0)).toEqual({
      ok: false,
      error: 'invalid_title',
    })
  })

  it('tidies whitespace in the title and keeps the approval flag', () => {
    const { db, tata } = family()
    const task = must(
      createTask(db, tata, { ...CAR, title: '  Umýt   auto ', approvalRequired: false }, T0),
    )
    expect(task.title).toBe('Umýt auto')
    expect(task.approvalRequired).toBe(false)
  })
})

describe('approveTaskOffer (spec §5.2 path 1, score agreement)', () => {
  it("one taker's approval opens it: giver + taker agree", () => {
    const { db, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    const opened = must(approveTaskOffer(db, starsi, task.id, 18, T1))
    expect(opened).toMatchObject({ status: 'open', score: 18, agreedAt: T1.toISOString() })
    expect(auditActions(db, task.id).map((a) => a.action)).toEqual([
      'task.created',
      'task.score_approved',
      'task.agreed',
    ])
    expect(db.select().from(taskScoreApprovals).all().at(-1)).toEqual({
      taskId: task.id,
      userId: starsi,
      offerRound: 1,
      score: 18,
      approvedAt: T1.toISOString(),
    })
    const agreed = db
      .select({ before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, 'task.agreed'))
      .get()
    expect(agreed && JSON.parse(agreed.before ?? 'null')).toEqual({
      status: 'proposed',
      score: 18,
      offerRound: 1,
    })
    expect(agreed && JSON.parse(agreed.after ?? 'null')).toEqual({
      status: 'open',
      score: 18,
      offerRound: 1,
      reservedBy: null,
      reservedVia: null,
      reservedGiverId: null,
      accepted: [1],
      closed: [],
    })
  })

  it('rolls back the approval and the opening when the audit write fails', () => {
    const { db, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    db.$client.exec(
      `CREATE TRIGGER fail_agreed BEFORE INSERT ON audit_log WHEN NEW.action = 'task.agreed'
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    expect(() => approveTaskOffer(db, starsi, task.id, 18, T1)).toThrow(/audit down/)
    expect(db.select().from(tasks).get()).toMatchObject({ status: 'proposed', agreedAt: null })
    expect(db.select().from(taskScoreApprovals).all()).toHaveLength(1)
    expect(auditActions(db, task.id).map((a) => a.action)).toEqual(['task.created'])
  })

  it('a new offer round: earlier approvals stop counting, even for the same number', () => {
    const { db, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    // What bidding (#34) will do: a new offer of the same 18 points.
    db.update(tasks).set({ offerRound: 2 }).where(eq(tasks.id, task.id)).run()
    expect(pendingApprovals(db, starsi)[0]?.approvedBy).toEqual([])
    // Starší's yes alone is not an agreement: Táta's round-1 approval no longer counts.
    expect(must(approveTaskOffer(db, starsi, task.id, 18, T1)).status).toBe('proposed')
    // Táta can approve 18 again in round 2 (no clash with his round-1 row), which agrees it.
    expect(must(approveTaskOffer(db, tata, task.id, 18, T2)).status).toBe('open')
    expect(db.select().from(taskScoreApprovals).all()).toHaveLength(3)
  })

  it('refuses an offer that is not the one shown (offer changed)', () => {
    const { db, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    expect(approveTaskOffer(db, starsi, task.id, 20, T1)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(db.select().from(taskScoreApprovals).all()).toHaveLength(1)
    expect(auditActions(db, task.id)).toHaveLength(1)
    expect(db.select().from(tasks).get()).toMatchObject({ status: 'proposed' })
  })

  it('the giver cannot approve twice; the admin is never a party', () => {
    const { db, tata, admin } = family()
    const task = must(createTask(db, tata, CAR, T0))
    expect(approveTaskOffer(db, tata, task.id, 18, T1)).toEqual({
      ok: false,
      error: 'already_approved',
    })
    expect(approveTaskOffer(db, admin, task.id, 18, T1)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
    expect(auditActions(db, task.id)).toHaveLength(1)
  })

  it('an open task takes no more approvals; an unknown task is not found', () => {
    const { db, tata, starsi, mladsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    must(approveTaskOffer(db, starsi, task.id, 18, T1))
    expect(approveTaskOffer(db, mladsi, task.id, 18, T1)).toEqual({
      ok: false,
      error: 'not_proposed',
    })
    expect(approveTaskOffer(db, mladsi, 999, 18, T1)).toEqual({ ok: false, error: 'not_found' })
  })

  it('an inactive taker cannot approve', () => {
    const { db, tata, starsi } = family()
    db.update(users).set({ active: false }).where(eq(users.id, starsi)).run()
    const task = must(createTask(db, tata, CAR, T0))
    expect(approveTaskOffer(db, starsi, task.id, 18, T1)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
  })
})

describe('pendingApprovals ("Čeká na tebe")', () => {
  it('takers see new offers until one of them approves; the giver and admin see none', () => {
    const { db, tata, starsi, mladsi, admin } = family()
    const task = must(createTask(db, tata, CAR, T0))
    expect(pendingApprovals(db, starsi).map((t) => t.id)).toEqual([task.id])
    expect(pendingApprovals(db, mladsi)[0]).toMatchObject({
      title: 'Umýt auto',
      score: 18,
      createdByName: 'Táta',
      approvedBy: ['Táta'],
    })
    expect(pendingApprovals(db, tata)).toEqual([])
    expect(pendingApprovals(db, admin)).toEqual([])
    must(approveTaskOffer(db, starsi, task.id, 18, T1))
    expect(pendingApprovals(db, mladsi)).toEqual([])
  })

  it('a giver sees a task whose offering giver no longer counts', () => {
    const { db, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    const mama = db
      .insert(users)
      .values({
        username: 'mama',
        displayName: 'Máma',
        role: 'giver',
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      })
      .returning()
      .get().id
    db.update(users).set({ active: false }).where(eq(users.id, tata)).run()
    expect(pendingApprovals(db, mama).map((t) => t.id)).toEqual([task.id])
    expect(pendingApprovals(db, starsi).map((t) => t.id)).toEqual([task.id])
  })
})

describe('a second giver', () => {
  it('completes the agreement once the offering giver no longer counts', () => {
    const { db, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    const mama = db
      .insert(users)
      .values({
        username: 'mama',
        displayName: 'Máma',
        role: 'giver',
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      })
      .returning()
      .get().id
    db.update(users).set({ active: false }).where(eq(users.id, tata)).run()
    expect(must(approveTaskOffer(db, starsi, task.id, 18, T1)).status).toBe('proposed')
    expect(must(approveTaskOffer(db, mama, task.id, 18, T2)).status).toBe('open')
  })
})

describe('listTasks', () => {
  it('lists every task newest first with its state', () => {
    const { db, tata, starsi } = family()
    const a = must(createTask(db, tata, CAR, T0))
    const b = must(createTask(db, tata, { ...CAR, title: 'Uklidit sklep', score: 25 }, T0))
    must(approveTaskOffer(db, starsi, a.id, 18, T1))
    expect(listTasks(db).map((t) => [t.title, t.status])).toEqual([
      ['Uklidit sklep', 'proposed'],
      ['Umýt auto', 'open'],
    ])
    expect(b.status).toBe('proposed')
  })
})

describe('resolveProposedTasks (people changed)', () => {
  it('opens a proposed task that is now agreed, logged as the system', () => {
    const { db, tata, starsi } = family()
    db.update(users).set({ role: 'giver' }).where(eq(users.id, starsi)).run()
    const task = must(createTask(db, tata, CAR, T0))
    // Starší approved as... nobody yet. Record a taker-side approval, then make him a taker.
    db.insert(taskScoreApprovals)
      .values({
        taskId: task.id,
        userId: starsi,
        offerRound: 1,
        score: 18,
        approvedAt: T0.toISOString(),
      })
      .run()
    db.update(users).set({ role: 'taker' }).where(eq(users.id, starsi)).run()
    db.transaction((tx) => {
      resolveProposedTasks(tx, listPeople(tx), T1)
    })
    expect(db.select().from(tasks).get()).toMatchObject({ status: 'open' })
    expect(auditActions(db, task.id).at(-1)).toEqual({
      action: 'task.agreed',
      actor: null,
      kind: 'system',
    })
  })

  it('runs on a real people change (updateUser with the default hooks)', () => {
    const { db, admin, tata, starsi } = family()
    const task = must(createTask(db, tata, CAR, T0))
    const byAdmin = { kind: 'user', userId: admin } as const
    must(updateUser(db, byAdmin, tata, { active: false }, T0))
    // No active giver: Starší's yes waits.
    expect(must(approveTaskOffer(db, starsi, task.id, 18, T1)).status).toBe('proposed')
    must(updateUser(db, byAdmin, tata, { active: true }, T2))
    expect(db.select().from(tasks).get()).toMatchObject({
      status: 'open',
      agreedAt: T2.toISOString(),
    })
    expect(auditActions(db, task.id).at(-1)).toEqual({
      action: 'task.agreed',
      actor: null,
      kind: 'system',
    })
  })

  it('leaves tasks that still wait for a taker alone', () => {
    const { db, tata } = family()
    must(createTask(db, tata, CAR, T0))
    db.transaction((tx) => {
      resolveProposedTasks(tx, listPeople(tx), T1)
    })
    expect(db.select().from(tasks).get()).toMatchObject({ status: 'proposed' })
    expect(db.select().from(auditLog).all()).toHaveLength(1)
  })
})
