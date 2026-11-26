import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  auditLog,
  descriptionChanges,
  taskScoreApprovals,
  taskThread,
  tasks,
  templates,
} from '~/server/db/schema'
import { createOnDemandInstance, selfLogInstance } from '~/server/instances/instances'
import { acceptLowestTaskBid, acceptOffer, placeBid, reopenBidding } from '~/server/tasks/bidding'
import { cancelTask, completeTask, releaseTask, reserveTask } from '~/server/tasks/lifecycle'
import { approveTaskOffer, createTask } from '~/server/tasks/tasks'
import type { Family } from '~/server/tasks/testing'
import {
  audits,
  car,
  failAuditOn,
  family,
  json,
  must,
  row,
  T0,
  T1,
  T2,
  T3,
} from '~/server/tasks/testing'
import { acceptOfferOnTemplate, bidOnTemplate } from '~/server/templates/scoreChange'
import { approveTemplateScore, createTemplate } from '~/server/templates/templates'
import { agreedTemplate, templateAudits } from '~/server/templates/testing'
import {
  answerDescriptionChange,
  changeDescriptionOf,
  settleStaleDescription,
} from './descriptions'
import { waitingDescriptionOf } from './rows'

const task = (id: number) => ({ kind: 'task', id }) as const
const tpl = (id: number) => ({ kind: 'template', id }) as const

/** "Umýt auto" (18) with text "old", agreed by Starší: open. */
function openCar(f: Family): number {
  const id = must(
    createTask(
      f.db,
      f.tata,
      { title: 'Umýt auto', score: 18, approvalRequired: true, description: 'old' },
      T0,
    ),
  ).id
  must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
  return id
}

const changes = (f: Family) =>
  f.db.select().from(descriptionChanges).orderBy(asc(descriptionChanges.id)).all()

const entries = (f: Family, id: number) =>
  f.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'task'), eq(auditLog.entityId, String(id))))
    .orderBy(asc(auditLog.id))
    .all()

const lastOf = (f: Family, id: number, action: string) =>
  entries(f, id)
    .filter((e) => e.action === action)
    .at(-1)

const templateText = (f: Family, id: number) =>
  f.db.select().from(templates).where(eq(templates.id, id)).get()?.description

const roundApprovals = (f: Family, id: number, offerRound: number) =>
  f.db
    .select()
    .from(taskScoreApprovals)
    .where(and(eq(taskScoreApprovals.taskId, id), eq(taskScoreApprovals.offerRound, offerRound)))
    .all()
    .map((a) => a.userId)

describe('a proposed task: the change applies at once and resets the agreement (ruling 7)', () => {
  it('applies with one task.description_changed entry', () => {
    const f = family()
    const id = car(f)
    expect(changeDescriptionOf(f.db, task(id), f.tata, 'Celé auto, i kola', T1)).toEqual({
      ok: true,
      value: 'applied',
    })
    expect(row(f.db, id)?.description).toBe('Celé auto, i kola')
    expect(audits(f.db, id).filter((a) => a.startsWith('task.description'))).toEqual([
      'task.description_changed',
    ])
    expect(changes(f)).toEqual([])
  })

  it('closes open bids, starts a new round with the changing giver as the only approver', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.mladsi, id, 25, T1))
    const bid = f.db.select().from(taskThread).all().at(-1)
    const offer = f.db.select().from(taskThread).all().at(0)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'nový', T2))
    const saved = row(f.db, id)
    expect(saved).toMatchObject({ offerRound: 2, score: 18, description: 'nový' })
    expect(roundApprovals(f, id, 2)).toEqual([f.tata])
    const rows = f.db.select().from(taskThread).orderBy(asc(taskThread.id)).all()
    expect(rows.find((r) => r.id === bid?.id)?.closedAs).toBe('closed')
    const newOffer = rows.at(-1)
    expect(newOffer).toMatchObject({ side: 'giver', userId: f.tata, score: 18, closedAt: null })
    const entry = lastOf(f, id, 'task.description_changed')
    expect(json(entry?.before)).toEqual({
      description: null,
      score: 18,
      offerRound: 1,
      entryIds: [bid?.id],
      offerEntryId: offer?.id,
    })
    expect(json(entry?.after)).toEqual({
      description: 'nový',
      score: 18,
      offerRound: 2,
      entryId: newOffer?.id,
    })
    // The bid is gone: a giver has nothing to accept.
    expect(acceptLowestTaskBid(f.db, f.tata, id, 25, [f.mladsi], T3)).toEqual({
      ok: false,
      error: 'no_bids',
    })
  })

  it('removal: an empty text clears it', () => {
    const f = family()
    const id = must(
      createTask(
        f.db,
        f.tata,
        { title: 'x', score: 5, approvalRequired: true, description: 'a' },
        T0,
      ),
    ).id
    must(changeDescriptionOf(f.db, task(id), f.tata, '  ', T1))
    expect(row(f.db, id)?.description).toBeNull()
  })
})

describe('an agreed task: the change waits for a taker (spec §5.2)', () => {
  it('open: waits for either taker; the OK changes only the text', () => {
    const f = family()
    const id = openCar(f)
    const before = row(f.db, id)
    const threadBefore = f.db.select().from(taskThread).all()
    expect(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1)).toEqual({
      ok: true,
      value: 'waiting',
    })
    expect(row(f.db, id)?.description).toBe('old')
    const waiting = waitingDescriptionOf(f.db, task(id))
    expect(waiting).toEqual({
      id: waiting?.id,
      description: 'new',
      proposedBy: f.tata,
      createdAt: T1.toISOString(),
      waitingFor: [f.starsi, f.mladsi],
      waitingForNames: ['Starší', 'Mladší'],
    })
    const changeId = waiting?.id ?? 0
    expect(answerDescriptionChange(f.db, task(id), f.mladsi, changeId, true, T2)).toEqual({
      ok: true,
      value: 'agreed',
    })
    const after = row(f.db, id)
    expect(after).toEqual({ ...before, description: 'new' })
    expect(f.db.select().from(taskThread).all()).toEqual(threadBefore)
    expect(changes(f)[0]).toMatchObject({ closedAs: 'agreed', closedBy: f.mladsi })
    expect(waitingDescriptionOf(f.db, task(id))).toBeNull()
    const entry = lastOf(f, id, 'task.description_change_approved')
    expect(entry).toMatchObject({ actorUserId: f.mladsi })
    expect(json(entry?.before)).toEqual({ description: 'old', changeId })
    expect(json(entry?.after)).toEqual({ description: 'new', changeId })
  })

  it('open in a reopened round still waits (not proposed)', () => {
    const f = family()
    const id = openCar(f)
    must(reopenBidding(f.db, f.tata, id, T1))
    expect(changeDescriptionOf(f.db, task(id), f.tata, 'new', T2)).toEqual({
      ok: true,
      value: 'waiting',
    })
    expect(row(f.db, id)?.description).toBe('old')
  })

  it('reserved: only the reserver may answer', () => {
    const f = family()
    const id = openCar(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const waiting = waitingDescriptionOf(f.db, task(id))
    expect(waiting?.waitingFor).toEqual([f.starsi])
    expect(waiting?.waitingForNames).toEqual(['Starší'])
    const changeId = waiting?.id ?? 0
    expect(answerDescriptionChange(f.db, task(id), f.mladsi, changeId, true, T2)).toEqual({
      ok: false,
      error: 'not_involved',
    })
    must(answerDescriptionChange(f.db, task(id), f.starsi, changeId, true, T2))
    expect(row(f.db, id)?.description).toBe('new')
  })

  it('reserved, then released: the change stays and any taker may OK it (ruling 3)', () => {
    const f = family()
    const id = openCar(f)
    must(reserveTask(f.db, f.starsi, id, T1))
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    must(releaseTask(f.db, f.starsi, id, T2))
    const changeId = waitingDescriptionOf(f.db, task(id))?.id ?? 0
    must(answerDescriptionChange(f.db, task(id), f.mladsi, changeId, true, T3))
    expect(row(f.db, id)?.description).toBe('new')
  })

  it('a bid-won task released back to proposed applies the change (ruling 1)', () => {
    const f = family()
    const id = must(
      createTask(
        f.db,
        f.tata,
        { title: 'Umýt auto', score: 18, approvalRequired: true, description: 'old' },
        T0,
      ),
    ).id
    must(placeBid(f.db, f.mladsi, id, 22, T0))
    must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T1))
    const roundBefore = row(f.db, id)?.offerRound ?? 0
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const released = must(releaseTask(f.db, f.mladsi, id, T2))
    expect(released).toMatchObject({ status: 'proposed', description: 'new' })
    expect(row(f.db, id)).toMatchObject({ description: 'new', offerRound: roundBefore + 1 })
    expect(changes(f)[0]).toMatchObject({ closedAs: 'applied', closedBy: f.mladsi })
    const actions = audits(f.db, id)
    const at = actions.indexOf('task.released')
    expect(actions.slice(at)).toEqual(['task.released', 'task.description_changed'])
    expect(actions).not.toContain('task.description_change_discarded')
    const entry = lastOf(f, id, 'task.description_changed')
    const changeId = changes(f)[0]?.id
    expect(entry).toMatchObject({ actorUserId: f.mladsi })
    expect(json(entry?.before)).toEqual({ description: 'old', changeId })
    expect(json(entry?.after)).toEqual({ description: 'new', changeId })
    // No reset on top: the only approval in the new round is the re-offering giver's.
    expect(roundApprovals(f, id, roundBefore + 1)).toEqual([f.tata])
  })

  it('completion discards the change (ruling 2)', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    must(completeTask(f.db, f.starsi, id, T2))
    expect(row(f.db, id)?.description).toBe('old')
    expect(changes(f)[0]).toMatchObject({ closedAs: 'discarded', closedBy: f.starsi })
    const entry = lastOf(f, id, 'task.description_change_discarded')
    expect(json(entry?.after)).toEqual({ changeId: changes(f)[0]?.id, description: 'new' })
    expect(audits(f.db, id).at(-1)).toBe('task.description_change_discarded')
  })

  it('a cancel discards the change, closed by the cancelling parent (#252 review)', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    must(cancelTask(f.db, f.tata, id, undefined, T2))
    expect(row(f.db, id)).toMatchObject({ status: 'cancelled', description: 'old' })
    expect(changes(f)[0]).toMatchObject({ closedAs: 'discarded', closedBy: f.tata })
    const actions = audits(f.db, id)
    expect(actions.slice(actions.indexOf('task.cancelled'))).toEqual([
      'task.cancelled',
      'task.description_change_discarded',
    ])
  })

  it('a system step (the scheduler) discards with closedBy null and a system entry', () => {
    // No public path puts a change on an item that can expire (instances are not changeable),
    // so the system branch is run at the settle step itself, on a task that ended.
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    f.db.update(tasks).set({ status: 'expired' }).where(eq(tasks.id, id)).run()
    const ended = row(f.db, id)
    if (!ended) throw new Error('no row')
    f.db.transaction((tx) => settleStaleDescription(tx, ended, { kind: 'system' }, T2))
    expect(changes(f)[0]).toMatchObject({ closedAs: 'discarded', closedBy: null })
    expect(lastOf(f, id, 'task.description_change_discarded')).toMatchObject({
      actorUserId: null,
    })
    expect(row(f.db, id)?.description).toBe('old')
  })

  it('a second change replaces the first; an OK of the replaced one is offer_changed', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'one', T1))
    const first = changes(f)[0]?.id ?? 0
    must(changeDescriptionOf(f.db, task(id), f.tata, 'two', T2))
    const [a, b] = changes(f)
    expect(a).toMatchObject({ closedAs: 'replaced', closedBy: f.tata })
    expect(b).toMatchObject({ description: 'two', closedAt: null })
    const entry = lastOf(f, id, 'task.description_change_proposed')
    expect(json(entry?.before)).toEqual({ description: 'old' })
    expect(json(entry?.after)).toEqual({ description: 'two', changeId: b?.id, replacedId: first })
    expect(answerDescriptionChange(f.db, task(id), f.starsi, first, true, T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(row(f.db, id)?.description).toBe('old')
  })

  it('no change waiting → no_change', () => {
    const f = family()
    const id = openCar(f)
    expect(answerDescriptionChange(f.db, task(id), f.starsi, 1, true, T1)).toEqual({
      ok: false,
      error: 'no_change',
    })
  })

  it('a taker’s no closes it and keeps the text', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const changeId = changes(f)[0]?.id ?? 0
    expect(answerDescriptionChange(f.db, task(id), f.starsi, changeId, false, T2)).toEqual({
      ok: true,
      value: 'declined',
    })
    expect(row(f.db, id)?.description).toBe('old')
    expect(changes(f)[0]).toMatchObject({ closedAs: 'declined', closedBy: f.starsi })
    const entry = lastOf(f, id, 'task.description_change_declined')
    expect(json(entry?.before)).toEqual({ description: 'new', changeId })
    expect(json(entry?.after)).toEqual({ description: 'old' })
  })

  it('back to the text in force withdraws the waiting change (ruling 5)', () => {
    const f = family()
    const id = openCar(f)
    expect(changeDescriptionOf(f.db, task(id), f.tata, 'old', T1)).toEqual({
      ok: false,
      error: 'same_description',
    })
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    expect(changeDescriptionOf(f.db, task(id), f.tata, ' old\r\n', T2)).toEqual({
      ok: true,
      value: 'withdrawn',
    })
    expect(changes(f)[0]).toMatchObject({ closedAs: 'withdrawn', closedBy: f.tata })
    expect(audits(f.db, id).at(-1)).toBe('task.description_change_withdrawn')
  })

  it('removal waits too, and the OK sets no description', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, '', T1))
    expect(changes(f)[0]?.description).toBeNull()
    must(answerDescriptionChange(f.db, task(id), f.starsi, changes(f)[0]?.id ?? 0, true, T2))
    expect(row(f.db, id)?.description).toBeNull()
  })
})

describe('who and what may change', () => {
  it('a taker → not_a_giver; an instance → not_changeable; a done task → frozen', () => {
    const f = family()
    const id = openCar(f)
    expect(changeDescriptionOf(f.db, task(id), f.starsi, 'x', T1)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    const tid = agreedTemplate(f)
    const inst = must(createOnDemandInstance(f.db, f.tata, tid, T1)).id
    expect(changeDescriptionOf(f.db, task(inst), f.tata, 'x', T1)).toEqual({
      ok: false,
      error: 'not_changeable',
    })
    must(completeTask(f.db, f.starsi, id, T2))
    expect(changeDescriptionOf(f.db, task(id), f.tata, 'x', T3)).toEqual({
      ok: false,
      error: 'description_frozen',
    })
    expect(changeDescriptionOf(f.db, task(999), f.tata, 'x', T3)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('the change path normalises: 1000 fits, 1001 is refused and nothing is written', () => {
    const f = family()
    const id = car(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, ' y\r\n', T1))
    expect(row(f.db, id)?.description).toBe('y')
    expect(changeDescriptionOf(f.db, task(id), f.tata, 'a'.repeat(1001), T2)).toEqual({
      ok: false,
      error: 'description_too_long',
    })
    expect(row(f.db, id)?.description).toBe('y')
    must(changeDescriptionOf(f.db, task(id), f.tata, 'a'.repeat(1000), T2))
    expect(row(f.db, id)?.description).toBe('a'.repeat(1000))
  })

  it('create normalises: " x\\r\\n" stores "x"; 1001 → description_too_long', () => {
    const f = family()
    const input = { title: 'x', score: 5, approvalRequired: true }
    const made = must(createTask(f.db, f.tata, { ...input, description: ' x\r\n' }, T0))
    expect(made.description).toBe('x')
    expect(json(lastOf(f, made.id, 'task.created')?.after)).toMatchObject({ description: 'x' })
    expect(createTask(f.db, f.tata, { ...input, description: 'a'.repeat(1001) }, T0)).toEqual({
      ok: false,
      error: 'description_too_long',
    })
    expect(must(createTask(f.db, f.tata, input, T0)).description).toBeNull()
    const t = { ...input, schedule: null, deadline: null }
    expect(must(createTemplate(f.db, f.tata, { ...t, description: '\ty ' }, T0)).description).toBe(
      'y',
    )
    expect(createTemplate(f.db, f.tata, { ...t, description: 'a'.repeat(1001) }, T0)).toEqual({
      ok: false,
      error: 'description_too_long',
    })
  })
})

describe('templates (spec §5.1)', () => {
  const input = {
    title: 'Vynést koš',
    score: 10,
    approvalRequired: true,
    schedule: null,
    deadline: null,
  }

  it('proposed: applies at once and starts a new offer round (ruling 7)', () => {
    const f = family()
    const id = must(createTemplate(f.db, f.tata, input, T0)).id
    expect(changeDescriptionOf(f.db, tpl(id), f.tata, 'Až k popelnici', T1)).toEqual({
      ok: true,
      value: 'applied',
    })
    expect(templateText(f, id)).toBe('Až k popelnici')
    const saved = f.db.select().from(templates).where(eq(templates.id, id)).get()
    expect(saved).toMatchObject({ offerRound: 2, score: 10 })
    const log = templateAudits(f.db, id).filter((a) => a.action.includes('description'))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ action: 'template.description_changed', actor: f.tata })
    expect(log[0]?.before).toEqual({
      description: null,
      score: 10,
      offerRound: 1,
      entryIds: [],
      bidsFrom: 0,
    })
    expect(log[0]?.after).toMatchObject({ description: 'Až k popelnici', offerRound: 2 })
    // The old yes no longer counts: Starší's yes now is the first taker yes of round 2.
    must(approveTemplateScore(f.db, f.starsi, id, 10, T2))
    expect(f.db.select().from(templates).where(eq(templates.id, id)).get()?.status).toBe('active')
  })

  it('proposed with a bid (choreBidding on): the bid closes', () => {
    const f = family()
    const id = must(createTemplate(f.db, f.tata, input, T0)).id
    must(bidOnTemplate(f.db, f.mladsi, id, 14, T1, { choreBidding: true, bidRefusals: false }))
    must(changeDescriptionOf(f.db, tpl(id), f.tata, 'nový', T2))
    const entry = templateAudits(f.db, id).find((a) => a.action === 'template.description_changed')
    expect((entry?.before as { entryIds: number[] }).entryIds).toHaveLength(1)
    expect(
      acceptOfferOnTemplate(f.db, f.mladsi, id, 10, T3, { choreBidding: true, bidRefusals: false }),
    ).toEqual({
      ok: false,
      error: 'no_bid',
    })
  })

  it('agreed: waits, a taker OKs it; every step writes one template.* entry', () => {
    const f = family()
    const id = agreedTemplate(f)
    expect(changeDescriptionOf(f.db, tpl(id), f.tata, 'one', T1)).toEqual({
      ok: true,
      value: 'waiting',
    })
    expect(templateText(f, id)).toBeNull()
    must(changeDescriptionOf(f.db, tpl(id), f.tata, '', T1)) // back to none: withdrawn
    must(changeDescriptionOf(f.db, tpl(id), f.tata, 'two', T1))
    const no = changes(f).at(-1)?.id ?? 0
    must(answerDescriptionChange(f.db, tpl(id), f.starsi, no, false, T2))
    must(changeDescriptionOf(f.db, tpl(id), f.tata, 'three', T2))
    const yes = changes(f).at(-1)?.id ?? 0
    expect(waitingDescriptionOf(f.db, tpl(id))?.waitingFor).toEqual([f.starsi, f.mladsi])
    must(answerDescriptionChange(f.db, tpl(id), f.mladsi, yes, true, T3))
    expect(templateText(f, id)).toBe('three')
    const log = templateAudits(f.db, id)
      .filter((a) => a.action.includes('description'))
      .map((a) => a.action)
    expect(log).toEqual([
      'template.description_change_proposed',
      'template.description_change_withdrawn',
      'template.description_change_proposed',
      'template.description_change_declined',
      'template.description_change_proposed',
      'template.description_change_approved',
    ])
    const taskEntries = f.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.action.startsWith('task.description'))
    expect(taskEntries).toEqual([])
  })

  it('an instance gets the text in force at its birth (Review Focus 5)', () => {
    const f = family()
    const id = agreedTemplate(f)
    must(changeDescriptionOf(f.db, tpl(id), f.tata, 'new', T1))
    const early = must(createOnDemandInstance(f.db, f.tata, id, T1))
    expect(early.description).toBeNull()
    must(completeTask(f.db, f.starsi, early.id, T1))
    const changeId = changes(f)[0]?.id ?? 0
    must(answerDescriptionChange(f.db, tpl(id), f.starsi, changeId, true, T2))
    const late = must(createOnDemandInstance(f.db, f.tata, id, T2))
    expect(late.description).toBe('new')
    expect(json(lastOf(f, late.id, 'instance.created')?.after)).toMatchObject({
      description: 'new',
    })
    must(completeTask(f.db, f.starsi, late.id, T2))
    const logged = must(selfLogInstance(f.db, f.mladsi, id, 3, T3))
    expect(json(lastOf(f, logged.id, 'instance.self_logged')?.after)).toMatchObject({
      description: 'new',
    })
  })
})

describe('a stale page: seenDescription (ruling 8)', () => {
  /** Proposed "Umýt auto" with text "x". */
  const proposedCar = (f: Family) =>
    must(
      createTask(
        f.db,
        f.tata,
        { title: 'Umýt auto', score: 18, approvalRequired: true, description: 'x' },
        T0,
      ),
    ).id
  const stale = { ok: false, error: 'offer_changed' }

  it('approveTaskOffer: old text refused, current or normalised or missing goes through', () => {
    const f = family()
    const id = proposedCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'y', T1))
    const n = entries(f, id).length
    expect(approveTaskOffer(f.db, f.starsi, id, 18, T2, 'x')).toEqual(stale)
    expect(entries(f, id)).toHaveLength(n)
    expect(approveTaskOffer(f.db, f.starsi, id, 18, T2, ' y\r\n').ok).toBe(true)
    const other = proposedCar(f)
    expect(approveTaskOffer(f.db, f.starsi, other, 18, T2).ok).toBe(true)
  })

  it('null is a value: a text added since → offer_changed; still none → ok', () => {
    const f = family()
    const a = car(f)
    must(changeDescriptionOf(f.db, task(a), f.tata, 'y', T1))
    expect(approveTaskOffer(f.db, f.starsi, a, 18, T2, null)).toEqual(stale)
    const b = car(f)
    expect(approveTaskOffer(f.db, f.starsi, b, 18, T2, null).ok).toBe(true)
  })

  it('placeBid and acceptOffer check it too', () => {
    const f = family()
    const id = proposedCar(f)
    expect(placeBid(f.db, f.mladsi, id, 25, T1, 'old')).toEqual(stale)
    must(placeBid(f.db, f.mladsi, id, 25, T1, 'x'))
    expect(acceptOffer(f.db, f.mladsi, id, 18, T2, 'old')).toEqual(stale)
    expect(acceptOffer(f.db, f.mladsi, id, 18, T2, 'x').ok).toBe(true)
  })

  it('the template yes, accept and bid check it too', () => {
    const f = family()
    const input = {
      title: 'Vynést koš',
      score: 10,
      approvalRequired: true,
      schedule: null,
      deadline: null,
      description: 'x',
    }
    const on = { choreBidding: true, bidRefusals: false }
    const id = must(createTemplate(f.db, f.tata, input, T0)).id
    expect(approveTemplateScore(f.db, f.starsi, id, 10, T1, 'old')).toEqual(stale)
    expect(bidOnTemplate(f.db, f.mladsi, id, 14, T1, { ...on, seenDescription: 'old' })).toEqual(
      stale,
    )
    must(bidOnTemplate(f.db, f.mladsi, id, 14, T1, { ...on, seenDescription: 'x' }))
    expect(
      acceptOfferOnTemplate(f.db, f.mladsi, id, 10, T2, { ...on, seenDescription: null }),
    ).toEqual(stale)
    expect(
      acceptOfferOnTemplate(f.db, f.mladsi, id, 10, T2, { ...on, seenDescription: ' x ' }).ok,
    ).toBe(true)
    const other = must(createTemplate(f.db, f.tata, input, T0)).id
    expect(approveTemplateScore(f.db, f.starsi, other, 10, T1, 'x').ok).toBe(true)
  })
})

describe('rollback: a failed audit write leaves nothing behind', () => {
  it.each([
    ['applied', 'task.description_changed'],
    ['waiting', 'task.description_change_proposed'],
    ['OK', 'task.description_change_approved'],
    ['no', 'task.description_change_declined'],
  ])('%s', (what, action) => {
    const f = family()
    const id = what === 'applied' ? car(f) : openCar(f)
    if (what === 'OK' || what === 'no') must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const before = { task: row(f.db, id), changes: changes(f) }
    failAuditOn(f.db, action)
    const run = () =>
      what === 'applied' || what === 'waiting'
        ? changeDescriptionOf(f.db, task(id), f.tata, 'newer', T2)
        : answerDescriptionChange(
            f.db,
            task(id),
            f.starsi,
            changes(f)[0]?.id ?? 0,
            what === 'OK',
            T2,
          )
    expect(run).toThrow(/audit down/)
    expect({ task: row(f.db, id), changes: changes(f) }).toEqual(before)
  })
  it('withdrawn: back to the text in force', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const before = { task: row(f.db, id), changes: changes(f) }
    failAuditOn(f.db, 'task.description_change_withdrawn')
    expect(() => changeDescriptionOf(f.db, task(id), f.tata, 'old', T2)).toThrow(/audit down/)
    expect({ task: row(f.db, id), changes: changes(f) }).toEqual(before)
  })

  it('applied on release back to proposed: the release rolls back too', () => {
    const f = family()
    const id = must(
      createTask(
        f.db,
        f.tata,
        { title: 'Umýt auto', score: 18, approvalRequired: true, description: 'old' },
        T0,
      ),
    ).id
    must(placeBid(f.db, f.mladsi, id, 22, T0))
    must(acceptLowestTaskBid(f.db, f.tata, id, 22, [f.mladsi], T1))
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const before = { task: row(f.db, id), changes: changes(f), log: audits(f.db, id) }
    failAuditOn(f.db, 'task.description_changed')
    expect(() => releaseTask(f.db, f.mladsi, id, T2)).toThrow(/audit down/)
    expect({ task: row(f.db, id), changes: changes(f), log: audits(f.db, id) }).toEqual(before)
  })

  it('discarded on completion: the completion rolls back too', () => {
    const f = family()
    const id = openCar(f)
    must(changeDescriptionOf(f.db, task(id), f.tata, 'new', T1))
    const before = { task: row(f.db, id), changes: changes(f), log: audits(f.db, id) }
    failAuditOn(f.db, 'task.description_change_discarded')
    expect(() => completeTask(f.db, f.starsi, id, T2)).toThrow(/audit down/)
    expect({ task: row(f.db, id), changes: changes(f), log: audits(f.db, id) }).toEqual(before)
  })
})
