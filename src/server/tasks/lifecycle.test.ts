import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { auditLog, tasks, taskScoreApprovals, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import {
  approveTask,
  cancelTask,
  completeTask,
  REASON_MAX,
  rejectTask,
  releaseTask,
  reserveTask,
} from './lifecycle'
import { approveTaskOffer, createTask, listBoard, listPendingCompletions } from './tasks'
import { offerInStep, thread } from './testing'
import { threadOf } from './thread'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const T1 = new Date('2026-11-17T11:00:00.000Z')
const T2 = new Date('2026-11-17T12:00:00.000Z')

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

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

type Family = ReturnType<typeof family>

/** "Vysát obývák", 10 points, agreed by Táta and Starší: open. */
function openTask(f: Family, approvalRequired = true): number {
  const task = must(
    createTask(f.db, f.tata, { title: 'Vysát obývák', score: 10, approvalRequired }, T0),
  )
  must(approveTaskOffer(f.db, f.starsi, task.id, 10, T0))
  return task.id
}

/** The state a won bid leaves (bids arrive with #34): Mladší reserved at 12 via Táta. */
function bidWon(f: Family, id: number) {
  f.db
    .update(tasks)
    .set({
      status: 'reserved',
      reservedBy: f.mladsi,
      reservedVia: 'bid',
      reservedGiverId: f.tata,
      score: 12,
    })
    .where(eq(tasks.id, id))
    .run()
}

const failAuditOn = (db: Db, action: string) =>
  db.$client.exec(
    `CREATE TRIGGER fail_${action.replace('.', '_')} BEFORE INSERT ON audit_log
     WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
  )

const json = (text: string | null | undefined): unknown => JSON.parse(text ?? 'null')

const lastAudit = (db: Db) => db.select().from(auditLog).all().at(-1)
const row = (db: Db, id: number) => db.select().from(tasks).where(eq(tasks.id, id)).get()

describe('reserve and release (spec §5.4)', () => {
  it('a taker reserves an open task; the giver and others cannot take it for points', () => {
    const f = family()
    const id = openTask(f)
    expect(must(reserveTask(f.db, f.starsi, id, T1))).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
      reservedVia: 'tap',
    })
    expect(lastAudit(f.db)).toMatchObject({ action: 'task.reserved', actorUserId: f.starsi })
    // A step that does not leave `proposed` closes no thread rows, and says so.
    expect(json(lastAudit(f.db)?.after)).toMatchObject({ accepted: [], closed: [] })
    expect(reserveTask(f.db, f.mladsi, id, T1)).toEqual({ ok: false, error: 'wrong_state' })
    expect(completeTask(f.db, f.mladsi, id, T1)).toEqual({ ok: false, error: 'reserved_by_other' })
  })

  it('a giver cannot reserve; the admin cannot either', () => {
    const f = family()
    const id = openTask(f)
    expect(reserveTask(f.db, f.tata, id, T1)).toEqual({ ok: false, error: 'not_a_taker' })
    expect(reserveTask(f.db, f.admin, id, T1)).toEqual({ ok: false, error: 'not_a_taker' })
  })

  it('a proposed task cannot be reserved yet', () => {
    const f = family()
    const task = must(
      createTask(f.db, f.tata, { title: 'Umýt auto', score: 18, approvalRequired: true }, T0),
    )
    expect(reserveTask(f.db, f.starsi, task.id, T1)).toEqual({ ok: false, error: 'wrong_state' })
  })

  it('the taker releases his own; another taker may not; a giver may release anyone', () => {
    const f = family()
    const id = openTask(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    expect(releaseTask(f.db, f.mladsi, id, T1)).toEqual({ ok: false, error: 'not_allowed' })
    expect(must(releaseTask(f.db, f.starsi, id, T1))).toMatchObject({
      status: 'open',
      reservedBy: null,
    })
    must(reserveTask(f.db, f.mladsi, id, T1))
    expect(must(releaseTask(f.db, f.tata, id, T2))).toMatchObject({ status: 'open' })
    expect(lastAudit(f.db)).toMatchObject({ action: 'task.released', actorUserId: f.tata })
  })

  it('releasing a bid-won task reopens negotiation at the agreed score (spec §5.4 [call])', () => {
    const f = family()
    const id = openTask(f)
    bidWon(f, id)
    expect(must(releaseTask(f.db, f.mladsi, id, T1))).toMatchObject({
      status: 'proposed',
      score: 12,
      reservedBy: null,
      agreedAt: null,
      offerRound: 2,
    })
    // A new offer round: only the giver who accepted the bid has approved it so far.
    const approvals = f.db
      .select()
      .from(taskScoreApprovals)
      .where(eq(taskScoreApprovals.offerRound, 2))
      .all()
    expect(approvals.map((a) => [a.userId, a.score])).toEqual([[f.tata, 12]])
    // The giver's renewed approval is logged by the system, then the release shows the final state.
    const [renewed, released] = f.db.select().from(auditLog).all().slice(-2)
    expect(renewed).toMatchObject({ action: 'task.score_approved', actorKind: 'system' })
    // The giver's re-offer joins the thread and carries the task's score.
    const reOffer = threadOf(f.db, id).at(-1)
    expect(thread(f.db, id).at(-1)).toEqual(['giver', f.tata, 12, null])
    expect(offerInStep(f.db, id)).toBe(true)
    expect(json(renewed?.after)).toEqual({
      userId: f.tata,
      score: 12,
      offerRound: 2,
      entryId: reOffer?.id,
    })
    expect(released).toMatchObject({ action: 'task.released', actorUserId: f.mladsi })
    expect(json(released?.before)).toMatchObject({ status: 'reserved', offerRound: 1 })
    expect(json(released?.after)).toMatchObject({
      status: 'proposed',
      offerRound: 2,
      agreedAt: null,
      reservedBy: null,
    })
  })

  it('a failed audit write rolls back the whole bid-won release', () => {
    const f = family()
    const id = openTask(f)
    bidWon(f, id)
    failAuditOn(f.db, 'task.released')
    expect(() => releaseTask(f.db, f.mladsi, id, T1)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'reserved', reservedBy: f.mladsi, offerRound: 1 })
    expect(
      f.db.select().from(taskScoreApprovals).where(eq(taskScoreApprovals.offerRound, 2)).all(),
    ).toHaveLength(0)
    expect(
      f.db
        .select()
        .from(auditLog)
        .all()
        .map((a) => a.action),
    ).not.toContain('task.released')
  })
})

describe('complete, approve, reject (spec §5.5)', () => {
  it('Hotovo on an open task: pending for that taker, with completed_at', () => {
    const f = family()
    const id = openTask(f)
    expect(must(completeTask(f.db, f.mladsi, id, T1))).toMatchObject({
      status: 'done_unconfirmed',
      completedBy: f.mladsi,
      earnerId: f.mladsi,
      completedAt: T1.toISOString(),
      reservedBy: null,
    })
  })

  it('approval flag off: confirmed straight away', () => {
    const f = family()
    const id = openTask(f, false)
    expect(must(completeTask(f.db, f.starsi, id, T1))).toMatchObject({
      status: 'confirmed',
      earnerId: f.starsi,
    })
  })

  it('a giver approves: confirmed, points for the taker', () => {
    const f = family()
    const id = openTask(f)
    must(completeTask(f.db, f.starsi, id, T1))
    expect(approveTask(f.db, f.starsi, id, T2)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(must(approveTask(f.db, f.tata, id, T2))).toMatchObject({
      status: 'confirmed',
      earnerId: f.starsi,
      completedAt: T1.toISOString(),
    })
    const entry = lastAudit(f.db)
    expect(entry).toMatchObject({ action: 'task.approved', actorUserId: f.tata })
    expect(json(entry?.before)).toMatchObject({ status: 'done_unconfirmed', earnerId: f.starsi })
    expect(json(entry?.after)).toMatchObject({ status: 'confirmed', earnerId: f.starsi })
  })

  it('a failed audit write rolls back the approval', () => {
    const f = family()
    const id = openTask(f)
    must(completeTask(f.db, f.starsi, id, T1))
    failAuditOn(f.db, 'task.approved')
    expect(() => approveTask(f.db, f.tata, id, T2)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'done_unconfirmed', earnerId: f.starsi })
  })

  it('reject: a reserved task goes back to the same taker, with the reason logged', () => {
    const f = family()
    const id = openTask(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    must(completeTask(f.db, f.starsi, id, T1))
    expect(must(rejectTask(f.db, f.tata, id, '  Ještě je tam prach. ', T2))).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
      completedBy: null,
      completedAt: null,
      earnerId: null,
    })
    expect(lastAudit(f.db)).toMatchObject({
      action: 'task.rejected',
      reason: 'Ještě je tam prach.',
    })
  })

  it('reject: an unreserved task goes back to open; no reason is fine', () => {
    const f = family()
    const id = openTask(f)
    must(completeTask(f.db, f.mladsi, id, T1))
    expect(must(rejectTask(f.db, f.tata, id, undefined, T2))).toMatchObject({
      status: 'open',
      reservedBy: null,
    })
    expect(lastAudit(f.db)?.reason).toBeNull()
  })

  it('a reason of exactly the limit is kept, also when it only fits after trimming', () => {
    const f = family()
    const id = openTask(f)
    must(completeTask(f.db, f.mladsi, id, T1))
    const full = 'x'.repeat(REASON_MAX)
    must(rejectTask(f.db, f.tata, id, `  ${full}  `, T2))
    expect(lastAudit(f.db)?.reason).toBe(full)
  })

  it('reject refuses a reason that is too long, and takers cannot reject', () => {
    const f = family()
    const id = openTask(f)
    must(completeTask(f.db, f.mladsi, id, T1))
    expect(rejectTask(f.db, f.tata, id, 'x'.repeat(REASON_MAX + 1), T2)).toEqual({
      ok: false,
      error: 'reason_too_long',
    })
    expect(rejectTask(f.db, f.starsi, id, undefined, T2)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
  })

  it('"Hotovo bez bodů": a giver completes it, closed with no points and no approval', () => {
    const f = family()
    const id = openTask(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    expect(must(completeTask(f.db, f.tata, id, T2))).toMatchObject({
      status: 'confirmed',
      completedBy: f.tata,
      earnerId: null,
    })
  })

  it('a confirmed task takes no more steps; an unknown task is not found', () => {
    const f = family()
    const id = openTask(f, false)
    must(completeTask(f.db, f.starsi, id, T1))
    expect(completeTask(f.db, f.mladsi, id, T2)).toEqual({ ok: false, error: 'wrong_state' })
    expect(rejectTask(f.db, f.tata, id, undefined, T2)).toEqual({ ok: false, error: 'wrong_state' })
    expect(reserveTask(f.db, f.starsi, 999, T2)).toEqual({ ok: false, error: 'not_found' })
  })

  it('a refused step writes nothing', () => {
    const f = family()
    const id = openTask(f)
    const before = f.db.select().from(auditLog).all().length
    reserveTask(f.db, f.tata, id, T1)
    expect(f.db.select().from(auditLog).all()).toHaveLength(before)
    expect(row(f.db, id)?.status).toBe('open')
  })
})

describe('board and approval lists', () => {
  it('the board holds open, reserved and pending tasks, oldest first, with names', () => {
    const f = family()
    const proposed = must(
      createTask(f.db, f.tata, { title: 'Umýt auto', score: 18, approvalRequired: true }, T0),
    ).id
    const open = openTask(f)
    const reserved = openTask(f)
    must(reserveTask(f.db, f.starsi, reserved, T1))
    const pending = openTask(f)
    must(reserveTask(f.db, f.mladsi, pending, T1))
    must(completeTask(f.db, f.mladsi, pending, T1))
    const confirmed = openTask(f, false)
    must(completeTask(f.db, f.starsi, confirmed, T1))

    const board = listBoard(f.db)
    expect(board.map((t) => t.id)).toEqual([open, reserved, pending])
    expect(board.map((t) => t.id)).not.toContain(proposed)
    expect(board[1]?.reservedBy).toEqual({ id: f.starsi, name: 'Starší' })
    expect(board[2]).toMatchObject({
      status: 'done_unconfirmed',
      reservedBy: { id: f.mladsi, name: 'Mladší' },
      completedBy: { id: f.mladsi, name: 'Mladší' },
      completedAt: T1.toISOString(),
      earnerId: f.mladsi,
    })
  })

  it('pending completions are listed oldest done first', () => {
    const f = family()
    const later = openTask(f)
    const earlier = openTask(f)
    openTask(f)
    must(completeTask(f.db, f.starsi, later, T2))
    must(completeTask(f.db, f.mladsi, earlier, T1))
    expect(listPendingCompletions(f.db).map((t) => [t.id, t.completedBy?.name])).toEqual([
      [earlier, 'Mladší'],
      [later, 'Starší'],
    ])
  })
})

describe('cancel (spec §5.6 [call])', () => {
  it('a giver cancels a proposed task: its thread closes', () => {
    const f = family()
    const id = must(
      createTask(f.db, f.tata, { title: 'Vysát obývák', score: 10, approvalRequired: true }, T0),
    ).id
    expect(must(cancelTask(f.db, f.tata, id, undefined, T1)).status).toBe('cancelled')
    expect(threadOf(f.db, id).map((e) => e.closedAs)).toEqual(['closed'])
  })

  it('a giver cancels an open and a reserved task; the reason is logged, blank is none', () => {
    const f = family()
    const open = openTask(f)
    must(cancelTask(f.db, f.tata, open, '   ', T1))
    expect(lastAudit(f.db)).toMatchObject({ action: 'task.cancelled', reason: null })
    const reserved = openTask(f)
    must(reserveTask(f.db, f.starsi, reserved, T1))
    expect(must(cancelTask(f.db, f.tata, reserved, ' Už to udělala máma. ', T2))).toMatchObject({
      status: 'cancelled',
      reservedBy: null,
    })
    expect(lastAudit(f.db)).toMatchObject({
      action: 'task.cancelled',
      actorUserId: f.tata,
      reason: 'Už to udělala máma.',
    })
    expect(json(lastAudit(f.db)?.before)).toMatchObject({
      status: 'reserved',
      reservedBy: f.starsi,
    })
  })

  it('a taker and the admin cannot cancel', () => {
    const f = family()
    const id = openTask(f)
    expect(cancelTask(f.db, f.starsi, id, undefined, T1)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(cancelTask(f.db, f.admin, id, undefined, T1)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
  })

  it('done, confirmed and cancelled tasks cannot be cancelled', () => {
    const f = family()
    const done = openTask(f)
    must(completeTask(f.db, f.starsi, done, T1))
    expect(cancelTask(f.db, f.tata, done, undefined, T2)).toEqual({
      ok: false,
      error: 'wrong_state',
    })
    must(approveTask(f.db, f.tata, done, T2))
    expect(cancelTask(f.db, f.tata, done, undefined, T2)).toEqual({
      ok: false,
      error: 'wrong_state',
    })
    const id = openTask(f)
    must(cancelTask(f.db, f.tata, id, undefined, T1))
    expect(cancelTask(f.db, f.tata, id, undefined, T2)).toEqual({
      ok: false,
      error: 'wrong_state',
    })
  })

  it('a reason of exactly REASON_MAX is kept, one more is refused', () => {
    const f = family()
    const id = openTask(f)
    expect(cancelTask(f.db, f.tata, id, 'x'.repeat(REASON_MAX + 1), T1)).toEqual({
      ok: false,
      error: 'reason_too_long',
    })
    must(cancelTask(f.db, f.tata, id, 'x'.repeat(REASON_MAX), T1))
    expect(lastAudit(f.db)?.reason).toHaveLength(REASON_MAX)
  })

  it('a cancelled task leaves the board and cannot be done', () => {
    const f = family()
    const id = openTask(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    must(cancelTask(f.db, f.tata, id, undefined, T1))
    expect(completeTask(f.db, f.starsi, id, T2)).toEqual({ ok: false, error: 'wrong_state' })
    expect(listBoard(f.db).map((t) => t.id)).not.toContain(id)
  })

  it('a failed audit write rolls the cancel back', () => {
    const f = family()
    const id = openTask(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    failAuditOn(f.db, 'task.cancelled')
    expect(() => cancelTask(f.db, f.tata, id, undefined, T2)).toThrow(/audit down/)
    expect(row(f.db, id)).toMatchObject({ status: 'reserved', reservedBy: f.starsi })
  })
})
