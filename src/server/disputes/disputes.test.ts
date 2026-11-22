import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DisputeKind } from '~/domain'
import { auditLog, disputes, settlements } from '~/server/db/schema'
import { doneTask, MEETING, SAT, week } from '~/server/settlement/testing'
import { agreedTemplate } from '~/server/templates/testing'
import { rejectTask } from '~/server/tasks'
import { rejectionsSince } from '~/server/tasks/rejections'
import { createTemplate } from '~/server/templates/templates'
import { failAuditOn, json, must, rawTask, T0 } from '~/server/tasks/testing'
import { disputeMarks, insertOpen, listDisputes, markKey, openDisputeIn } from '.'

// Opening a dispute (spec §5.11, #46): the store side of the domain rule. Keys: README.md.
const AT = MEETING

function setup() {
  const f = week()
  const confirmed = doneTask(f, { score: 22, completedAt: SAT, earner: f.starsi })
  const pending = doneTask(f, {
    score: 5,
    completedAt: SAT,
    earner: f.starsi,
    status: 'done_unconfirmed',
  })
  return { ...f, confirmed, pending }
}

/** A rejection of a fresh pending task by Táta; returns its `task.rejected` audit entry id. */
function rejection(f: ReturnType<typeof setup>, earner: number): number {
  const id = doneTask(f, { score: 4, completedAt: SAT, earner, status: 'done_unconfirmed' })
  must(rejectTask(f.db, f.tata, id, 'Sklo zůstalo u dveří.', SAT))
  const entry = rejectionsSince(f.db, new Date(0)).find((r) => r.taskId === id)
  if (!entry) throw new Error('no rejection')
  return entry.entryId
}

function settlement(f: ReturnType<typeof setup>, takerId: number): number {
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

const rows = (f: ReturnType<typeof setup>) => f.db.select().from(disputes).all()
const opened = (f: ReturnType<typeof setup>) =>
  f.db.select().from(auditLog).where(eq(auditLog.action, 'dispute.opened')).all()

function close(
  f: ReturnType<typeof setup>,
  id: number,
  status: 'dismissed' | 'corrected',
  note: string,
  at = AT,
) {
  f.db
    .update(disputes)
    .set({ status, resolvedBy: f.admin, resolvedAt: at.toISOString(), note })
    .where(eq(disputes.id, id))
    .run()
}

describe('openDisputeIn', () => {
  it('a taker disputes his confirmed completion: one open row and its audit entry', () => {
    const f = setup()
    const { id } = must(
      openDisputeIn(f.db, f.starsi, { kind: 'completion', id: f.confirmed }, '  Byl i kufr. ', AT),
    )
    expect(rows(f)).toEqual([
      {
        id,
        itemKind: 'completion',
        itemId: f.confirmed,
        openedBy: f.starsi,
        reason: 'Byl i kufr.',
        openedAt: AT.toISOString(),
        status: 'open',
        resolvedBy: null,
        resolvedAt: null,
        note: null,
      },
    ])
    const [entry] = opened(f)
    expect(entry).toMatchObject({
      actorKind: 'user',
      actorUserId: f.starsi,
      entityType: 'dispute',
      entityId: String(id),
      at: AT.toISOString(),
    })
    expect(json(entry?.after)).toEqual({
      itemKind: 'completion',
      itemId: f.confirmed,
      reason: 'Byl i kufr.',
      value: { score: 22 },
    })
  })

  it('a giver disputes an agreed task score, a template score, a settlement and a rejection', () => {
    const f = setup()
    const task = doneTask(f, { score: 9, completedAt: SAT, earner: null, status: 'open' })
    const template = agreedTemplate(f)
    const record = settlement(f, f.mladsi)
    const entry = rejection(f, f.mladsi)
    for (const [kind, id] of [
      ['task_score', task],
      ['template_score', template],
      ['settlement', record],
      ['rejection', entry],
    ] as const) {
      expect(openDisputeIn(f.db, f.tata, { kind, id }, 'Nesedí to.', AT).ok, kind).toBe(true)
    }
    expect(opened(f).map((e) => json(e.after))).toEqual([
      { itemKind: 'task_score', itemId: task, reason: 'Nesedí to.', value: { score: 9 } },
      { itemKind: 'template_score', itemId: template, reason: 'Nesedí to.', value: { score: 3 } },
      {
        itemKind: 'settlement',
        itemId: record,
        reason: 'Nesedí to.',
        value: { level: 'lower', deducted: 50 },
      },
      { itemKind: 'rejection', itemId: entry, reason: 'Nesedí to.', value: { score: 4 } },
    ])
  })

  it('an agreed task that was cancelled later stays disputable (locked by agreed_at)', () => {
    const f = setup()
    const task = doneTask(f, { score: 9, completedAt: SAT, earner: null, status: 'cancelled' })
    expect(openDisputeIn(f.db, f.starsi, { kind: 'task_score', id: task }, 'x', AT).ok).toBe(true)
  })

  it.each<[string, (f: ReturnType<typeof setup>) => { kind: DisputeKind; id: number }, string]>([
    ['the admin', (f) => ({ kind: 'completion', id: f.confirmed }), 'not_a_party'],
    ['a proposed task score', (f) => ({ kind: 'task_score', id: rawTask(f) }), 'not_locked'],
    ['a pending completion', (f) => ({ kind: 'completion', id: f.pending }), 'not_locked'],
    [
      'a proposed template score',
      (f) => ({
        kind: 'template_score',
        id: must(
          createTemplate(
            f.db,
            f.tata,
            { title: 'Koš', score: 2, approvalRequired: true, schedule: null, deadline: null },
            T0,
          ),
        ).id,
      }),
      'not_locked',
    ],
    ['an unknown task score', () => ({ kind: 'task_score', id: 999 }), 'not_found'],
    ['an unknown template', () => ({ kind: 'template_score', id: 999 }), 'not_found'],
    ['an unknown completion', () => ({ kind: 'completion', id: 999 }), 'not_found'],
    ['an unknown settlement', () => ({ kind: 'settlement', id: 999 }), 'not_found'],
    ['an unknown rejection', () => ({ kind: 'rejection', id: 999 }), 'not_found'],
    [
      'an audit entry that is not a rejection',
      (f) => ({ kind: 'rejection', id: f.db.select().from(auditLog).all()[0]?.id ?? 0 }),
      'not_found',
    ],
    ['an adjustment (no table before #48)', () => ({ kind: 'adjustment', id: 1 }), 'not_found'],
  ])('%s is refused and nothing is written', (what, item, error) => {
    const f = setup()
    const by = what === 'the admin' ? f.admin : f.starsi
    expect(openDisputeIn(f.db, by, item(f), 'Nesedí to.', AT)).toEqual({ ok: false, error })
    expect(rows(f)).toEqual([])
    expect(opened(f)).toEqual([])
  })

  it('a blank reason is reason_required', () => {
    const f = setup()
    const item = { kind: 'completion', id: f.confirmed } as const
    expect(openDisputeIn(f.db, f.starsi, item, '   ', AT)).toEqual({
      ok: false,
      error: 'reason_required',
    })
    expect(rows(f)).toEqual([])
  })

  it('a second open dispute on the same item is dispute_open; after it closes, a new one opens', () => {
    const f = setup()
    const item = { kind: 'completion', id: f.confirmed } as const
    const { id } = must(openDisputeIn(f.db, f.starsi, item, 'a', AT))
    expect(openDisputeIn(f.db, f.tata, item, 'b', AT)).toEqual({ ok: false, error: 'dispute_open' })
    close(f, id, 'dismissed', 'Sedí.')
    expect(openDisputeIn(f.db, f.tata, item, 'b', AT).ok).toBe(true)
  })

  it('the index refuses a second open row even past the domain check (race)', () => {
    const f = setup()
    const row = {
      itemKind: 'completion' as const,
      itemId: f.confirmed,
      openedBy: f.starsi,
      reason: 'a',
      openedAt: AT.toISOString(),
    }
    const first = f.db.transaction((tx) => insertOpen(tx, row))
    expect(first.ok).toBe(true)
    expect(f.db.transaction((tx) => insertOpen(tx, row))).toEqual({
      ok: false,
      error: 'dispute_open',
    })
  })

  it('a failed audit write rolls back the dispute', () => {
    const f = setup()
    failAuditOn(f.db, 'dispute.opened')
    expect(() =>
      openDisputeIn(f.db, f.starsi, { kind: 'completion', id: f.confirmed }, 'a', AT),
    ).toThrow(/audit down/)
    expect(rows(f)).toEqual([])
  })
})

describe('disputeMarks', () => {
  it('per item: the open dispute, else the newest closed one; none → missing', () => {
    const f = setup()
    const other = doneTask(f, { score: 3, completedAt: SAT, earner: f.mladsi })
    const third = doneTask(f, { score: 3, completedAt: SAT, earner: f.mladsi })
    const a = { kind: 'completion', id: f.confirmed } as const
    const b = { kind: 'completion', id: other } as const
    const c = { kind: 'completion', id: third } as const
    const d1 = must(openDisputeIn(f.db, f.starsi, a, 'x', AT)).id
    close(f, d1, 'dismissed', 'Sedí.')
    must(openDisputeIn(f.db, f.starsi, a, 'y', AT))
    const d2 = must(openDisputeIn(f.db, f.mladsi, b, 'x', AT)).id
    close(f, d2, 'dismissed', 'Starší.', AT)
    const d3 = must(openDisputeIn(f.db, f.mladsi, b, 'x', AT)).id
    close(f, d3, 'corrected', 'Novější.', new Date(AT.getTime() + 1000))
    const marks = disputeMarks(f.db, [a, b, c])
    expect(marks.get(markKey(a))).toEqual({ status: 'open' })
    expect(marks.get(markKey(b))).toEqual({ status: 'corrected', note: 'Novější.' })
    expect(marks.has(markKey(c))).toBe(false)
    expect(disputeMarks(f.db, [])).toEqual(new Map())
  })

  it('the same id under another kind is another item', () => {
    const f = setup()
    must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id: f.confirmed }, 'x', AT))
    expect(disputeMarks(f.db, [{ kind: 'task_score', id: f.confirmed }]).size).toBe(0)
  })
})

describe('rejectionsSince entryId', () => {
  it('is the id of the task.rejected audit entry', () => {
    const f = setup()
    const entryId = rejection(f, f.starsi)
    const entry = f.db.select().from(auditLog).where(eq(auditLog.id, entryId)).get()
    expect(entry?.action).toBe('task.rejected')
  })
})

describe('listDisputes (Rozporováno)', () => {
  function many() {
    const f = setup()
    const mine = must(
      openDisputeIn(f.db, f.starsi, { kind: 'completion', id: f.confirmed }, 'moje', AT),
    ).id
    const mladsiTask = doneTask(f, { score: 3, completedAt: SAT, earner: f.mladsi })
    const onMine = doneTask(f, { score: 3, completedAt: SAT, earner: f.starsi })
    const byTata = must(
      openDisputeIn(f.db, f.tata, { kind: 'completion', id: onMine }, 'táta', AT),
    ).id
    const template = must(
      openDisputeIn(f.db, f.mladsi, { kind: 'template_score', id: agreedTemplate(f) }, 'cena', AT),
    ).id
    const hisSettlement = must(
      openDisputeIn(f.db, f.mladsi, { kind: 'settlement', id: settlement(f, f.mladsi) }, 's', AT),
    ).id
    const hisCompletion = must(
      openDisputeIn(f.db, f.mladsi, { kind: 'completion', id: mladsiTask }, 'c', AT),
    ).id
    const hisRejection = must(
      openDisputeIn(f.db, f.mladsi, { kind: 'rejection', id: rejection(f, f.mladsi) }, 'r', AT),
    ).id
    return { f, mine, byTata, template, hisSettlement, hisCompletion, hisRejection }
  }

  it('a giver sees every dispute; a taker his own, those on his items and score disputes', () => {
    const m = many()
    const ids = (viewer: number, role: 'giver' | 'taker' | 'admin') =>
      listDisputes(m.f.db, { id: viewer, role })
        .map((e) => e.id)
        .sort((a, b) => a - b)
    expect(ids(m.f.tata, 'giver')).toEqual(
      [m.mine, m.byTata, m.template, m.hisSettlement, m.hisCompletion, m.hisRejection].sort(
        (a, b) => a - b,
      ),
    )
    expect(ids(m.f.starsi, 'taker')).toEqual([m.mine, m.byTata, m.template])
    expect(ids(m.f.admin, 'admin')).toEqual([])
  })

  it('an entry has exactly its keys; a settlement entry has its week and no title', () => {
    const m = many()
    const list = listDisputes(m.f.db, { id: m.f.tata, role: 'giver' })
    const mine = list.find((e) => e.id === m.mine)
    expect(mine).toEqual({
      id: m.mine,
      item: { kind: 'completion', id: m.f.confirmed },
      title: 'Vyndat myčku',
      week: null,
      takerName: 'Starší',
      openedByName: 'Starší',
      reason: 'moje',
      openedAt: AT.toISOString(),
      mark: { status: 'open' },
    })
    const s = list.find((e) => e.id === m.hisSettlement)
    expect(s).toMatchObject({
      title: '',
      week: { startsAt: m.f.p1.startsAt.toISOString(), endsAt: m.f.p1.cutoffAt.toISOString() },
      takerName: 'Mladší',
    })
    expect(list.find((e) => e.id === m.template)?.takerName).toBeNull()
  })

  it('every open one, plus the newest 5 closed, newest first', () => {
    const f = setup()
    const at = (n: number) => new Date(AT.getTime() + n * 1000)
    const closed: number[] = []
    for (let i = 0; i < 7; i++) {
      const t = doneTask(f, { score: 1, completedAt: SAT, earner: f.starsi })
      const id = must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id: t }, 'x', at(i))).id
      close(f, id, 'dismissed', 'n')
      closed.push(id)
    }
    const open: number[] = []
    for (let i = 0; i < 7; i++) {
      const t = doneTask(f, { score: 1, completedAt: SAT, earner: f.starsi })
      open.push(
        must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id: t }, 'x', at(10 + i))).id,
      )
    }
    expect(listDisputes(f.db, { id: f.starsi, role: 'taker' }).map((e) => e.id)).toEqual([
      ...open.reverse(),
      ...closed.slice(2).reverse(),
    ])
  })

  it('the viewer filter runs before the cap: other boys’ newer disputes take no places', () => {
    const f = setup()
    const at = (n: number) => new Date(AT.getTime() + n * 1000)
    const mine: number[] = []
    for (let i = 0; i < 8; i++) {
      const t = doneTask(f, { score: 1, completedAt: SAT, earner: f.starsi })
      const id = must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id: t }, 'x', at(i))).id
      close(f, id, 'dismissed', 'n')
      mine.push(id)
    }
    for (let i = 0; i < 10; i++) {
      const t = doneTask(f, { score: 1, completedAt: SAT, earner: f.mladsi })
      const id = must(
        openDisputeIn(f.db, f.mladsi, { kind: 'completion', id: t }, 'x', at(100 + i)),
      ).id
      close(f, id, 'dismissed', 'n')
    }
    expect(listDisputes(f.db, { id: f.starsi, role: 'taker' }).map((e) => e.id)).toEqual(
      mine.slice(3).reverse(),
    )
  })
})
