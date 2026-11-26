import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { featureFlags, tasks, templates } from '~/server/db/schema'
import { placeBid } from '~/server/tasks/bidding'
import {
  acceptOfferHandler,
  approveTaskOfferHandler,
  createTaskHandler,
  parseNewTask,
  parseTakerScore,
  placeBidHandler,
} from '~/server/tasks/functions'
import { reserveTask } from '~/server/tasks/lifecycle'
import { approveTaskOffer, getTaskDetail, listBoard, listTasks } from '~/server/tasks/tasks'
import type { Family } from '~/server/tasks/testing'
import { car, family, must, T0, T1, T2, T3 } from '~/server/tasks/testing'
import {
  acceptTemplateOfferHandler,
  approveTemplateScoreHandler,
  bidTemplateScoreHandler,
  createTemplateHandler,
} from '~/server/templates/functions'
import { parseNewTemplate, parseSeenScore } from '~/server/templates/parse'
import { createTemplate, getTemplateDetail, listTemplates } from '~/server/templates/templates'
import { agreedTemplate } from '~/server/templates/testing'
import { changeDescriptionOf } from './descriptions'
import {
  answerDescriptionHandler,
  changeDescriptionHandler,
  descriptionChangesWaitingHandler,
  parseDescriptionAnswer,
  parseDescriptionChange,
} from './functions'

const setFlag = (f: Family, key: string, enabled: boolean) =>
  f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, key)).run()

const on = (f: Family) => setFlag(f, 'descriptions', true)

/** Sets a task's description column directly (bypassing the switch). */
const setText = (f: Family, id: number, text: string) =>
  f.db.update(tasks).set({ description: text }).where(eq(tasks.id, id)).run()

const OFF = { ok: false, error: 'feature_off' }

describe('switch off', () => {
  it('both handlers → feature_off', () => {
    const f = family()
    const id = car(f)
    const target = { kind: 'task', id } as const
    expect(changeDescriptionHandler(f.db, f.tata, { target, description: 'x' }, T1)).toEqual(OFF)
    expect(
      answerDescriptionHandler(f.db, f.starsi, { target, changeId: 1, yes: true }, T1),
    ).toEqual(OFF)
  })

  it('a create with a description → feature_off; without (or blank) → ok', () => {
    const f = family()
    const input = { title: 'x', score: 5, approvalRequired: true }
    expect(createTaskHandler(f.db, f.tata, { ...input, description: 'y' }, T0)).toEqual(OFF)
    expect(createTaskHandler(f.db, f.tata, input, T0).ok).toBe(true)
    expect(createTaskHandler(f.db, f.tata, { ...input, description: ' \r\n' }, T0).ok).toBe(true)
    const t = { ...input, schedule: null, deadline: null }
    expect(createTemplateHandler(f.db, f.tata, { ...t, description: 'y' }, T0)).toEqual(OFF)
    expect(createTemplateHandler(f.db, f.tata, t, T0).ok).toBe(true)
  })

  it('every read masks the text and the waiting change', () => {
    const f = family()
    const id = car(f)
    must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
    setText(f, id, 'tajné')
    must(changeDescriptionOf(f.db, { kind: 'task', id }, f.tata, 'nové', T1))
    const tid = agreedTemplate(f)
    f.db.update(templates).set({ description: 'tajné' }).where(eq(templates.id, tid)).run()
    must(changeDescriptionOf(f.db, { kind: 'template', id: tid }, f.tata, 'nové', T1))
    const off = { descriptions: false }
    expect(getTaskDetail(f.db, id, off)?.task.description).toBeNull()
    expect(getTaskDetail(f.db, id, off)?.descriptionChange).toBeNull()
    expect(getTaskDetail(f.db, id)?.task.description).toBeNull()
    expect(listBoard(f.db, off)[0]?.description).toBeNull()
    expect(listTasks(f.db, off)[0]?.description).toBeNull()
    const bOff = { choreBidding: false, bidRefusals: false, descriptions: false }
    expect(listTemplates(f.db, f.tata, bOff)[0]?.description).toBeNull()
    expect(getTemplateDetail(f.db, tid, f.tata, bOff)?.template.description).toBeNull()
    expect(getTemplateDetail(f.db, tid, f.tata, bOff)?.descriptionChange).toBeNull()
    // Switch on: the same reads carry them.
    const shown = { descriptions: true }
    expect(listBoard(f.db, shown)[0]?.description).toBe('tajné')
    expect(listTasks(f.db, shown)[0]?.description).toBe('tajné')
    expect(getTaskDetail(f.db, id, shown)?.descriptionChange?.description).toBe('nové')
    const bOn = { choreBidding: false, bidRefusals: false, descriptions: true }
    expect(listTemplates(f.db, f.tata, bOn)[0]?.description).toBe('tajné')
    expect(getTemplateDetail(f.db, tid, f.tata, bOn)?.descriptionChange?.description).toBe('nové')
  })
})

describe('switch on', () => {
  it('a full round trip: change → waiting, a taker’s yes → agreed, the detail shows it', () => {
    const f = family()
    on(f)
    const id = car(f)
    must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
    const target = { kind: 'task', id } as const
    expect(changeDescriptionHandler(f.db, f.tata, { target, description: 'Celé' }, T1)).toEqual({
      ok: true,
      outcome: 'waiting',
    })
    const change = getTaskDetail(f.db, id, { descriptions: true })?.descriptionChange
    expect(change).toStrictEqual({
      id: change?.id,
      description: 'Celé',
      proposedBy: f.tata,
      createdAt: T1.toISOString(),
      waitingFor: [f.starsi, f.mladsi],
      waitingForNames: ['Starší', 'Mladší'],
    })
    const answer = { target, changeId: change?.id ?? 0, yes: true }
    expect(answerDescriptionHandler(f.db, f.mladsi, answer, T2)).toStrictEqual({
      ok: true,
      outcome: 'agreed',
    })
    const detail = getTaskDetail(f.db, id, { descriptions: true })
    expect(detail?.task.description).toBe('Celé')
    expect(detail?.descriptionChange).toBeNull()
    expect(answerDescriptionHandler(f.db, f.mladsi, answer, T2)).toStrictEqual({
      ok: false,
      error: 'no_change',
    })
  })

  it('reserved: waitingFor is exactly the reserver', () => {
    const f = family()
    on(f)
    const id = car(f)
    must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
    must(reserveTask(f.db, f.mladsi, id, T1, false))
    const target = { kind: 'task', id } as const
    changeDescriptionHandler(f.db, f.tata, { target, description: 'x' }, T1)
    expect(getTaskDetail(f.db, id, { descriptions: true })?.descriptionChange?.waitingFor).toEqual([
      f.mladsi,
    ])
  })

  it('a template create with 1001 characters → description_too_long', () => {
    const f = family()
    on(f)
    const t = { title: 'x', score: 5, approvalRequired: true, schedule: null, deadline: null }
    expect(
      createTemplateHandler(f.db, f.tata, { ...t, description: 'a'.repeat(1001) }, T0),
    ).toEqual({ ok: false, error: 'description_too_long' })
    const task = { title: 'x', score: 5, approvalRequired: true, description: 'ok' }
    expect(createTaskHandler(f.db, f.tata, task, T0).ok).toBe(true)
  })
})

describe('ruling 8 through the handlers', () => {
  /** A proposed task and a proposed template, each with text "x" then changed to "y". */
  function changed(enabled: boolean) {
    const f = family()
    on(f)
    setFlag(f, 'choreBidding', true)
    const id = car(f)
    must(changeDescriptionOf(f.db, { kind: 'task', id }, f.tata, 'y', T1))
    const t = { title: 'x', score: 10, approvalRequired: true, schedule: null, deadline: null }
    const tid = must(createTemplate(f.db, f.tata, t, T0)).id
    must(changeDescriptionOf(f.db, { kind: 'template', id: tid }, f.tata, 'y', T1))
    setFlag(f, 'descriptions', enabled)
    return { f, id, tid }
  }
  const stale = { ok: false, error: 'offer_changed' }

  it('switch on: an old text is refused by every taker action', () => {
    const { f, id, tid } = changed(true)
    const task = (score: number) => parseTakerScore({ taskId: id, score, seenDescription: 'old' })
    expect(approveTaskOfferHandler(f.db, f.starsi, task(18), T2)).toEqual(stale)
    expect(placeBidHandler(f.db, f.mladsi, task(25), T2)).toEqual(stale)
    must(placeBid(f.db, f.mladsi, id, 25, T2))
    expect(acceptOfferHandler(f.db, f.mladsi, task(18), T3)).toEqual(stale)
    const tpl = (score: number) =>
      parseSeenScore({ templateId: tid, score, seenDescription: 'old' })
    expect(approveTemplateScoreHandler(f.db, f.starsi, tpl(10), T2)).toEqual(stale)
    expect(bidTemplateScoreHandler(f.db, f.mladsi, tpl(14), T2)).toEqual(stale)
    expect(acceptTemplateOfferHandler(f.db, f.mladsi, tpl(10), T3)).toEqual(stale)
  })

  it('switch off: the field is ignored and the actions go through', () => {
    const { f, id, tid } = changed(false)
    const task = (score: number) => parseTakerScore({ taskId: id, score, seenDescription: 'old' })
    expect(placeBidHandler(f.db, f.mladsi, task(25), T2).ok).toBe(true)
    expect(acceptOfferHandler(f.db, f.mladsi, task(18), T3).ok).toBe(true)
    const tpl = (score: number) =>
      parseSeenScore({ templateId: tid, score, seenDescription: 'old' })
    expect(bidTemplateScoreHandler(f.db, f.mladsi, tpl(14), T2).ok).toBe(true)
    expect(acceptTemplateOfferHandler(f.db, f.mladsi, tpl(10), T3).ok).toBe(true)
    const other = car(f)
    expect(
      approveTaskOfferHandler(
        f.db,
        f.starsi,
        parseTakerScore({ taskId: other, score: 18, seenDescription: 'old' }),
        T2,
      ).ok,
    ).toBe(true)
  })

  it('switch on: a call with no seenDescription is refused by all six (ruling 2)', () => {
    const { f, id, tid } = changed(true)
    const task = (score: number) => ({ taskId: id, score })
    expect(approveTaskOfferHandler(f.db, f.starsi, task(18), T2)).toEqual(stale)
    expect(placeBidHandler(f.db, f.mladsi, task(25), T2)).toEqual(stale)
    must(placeBid(f.db, f.mladsi, id, 25, T2))
    expect(acceptOfferHandler(f.db, f.mladsi, task(18), T3)).toEqual(stale)
    const tpl = (score: number) => ({ templateId: tid, score })
    expect(approveTemplateScoreHandler(f.db, f.starsi, tpl(10), T2)).toEqual(stale)
    expect(bidTemplateScoreHandler(f.db, f.mladsi, tpl(14), T2)).toEqual(stale)
    expect(acceptTemplateOfferHandler(f.db, f.mladsi, tpl(10), T3)).toEqual(stale)
  })

  it('switch off: a call with no seenDescription goes through', () => {
    const { f, id, tid } = changed(false)
    expect(placeBidHandler(f.db, f.mladsi, { taskId: id, score: 25 }, T2).ok).toBe(true)
    expect(acceptOfferHandler(f.db, f.mladsi, { taskId: id, score: 18 }, T3).ok).toBe(true)
    expect(approveTaskOfferHandler(f.db, f.starsi, { taskId: car(f), score: 18 }, T2).ok).toBe(true)
    const tpl = (score: number) => ({ templateId: tid, score })
    expect(bidTemplateScoreHandler(f.db, f.mladsi, tpl(14), T2).ok).toBe(true)
    expect(acceptTemplateOfferHandler(f.db, f.mladsi, tpl(10), T3).ok).toBe(true)
    const t = { title: 'z', score: 6, approvalRequired: true, schedule: null, deadline: null }
    const fresh = must(createTemplate(f.db, f.tata, t, T0)).id
    const yes = { templateId: fresh, score: 6 }
    expect(approveTemplateScoreHandler(f.db, f.starsi, yes, T2).ok).toBe(true)
  })

  it('switch on: the current text (normalised) goes through', () => {
    const { f, id, tid } = changed(true)
    const ok1 = parseTakerScore({ taskId: id, score: 18, seenDescription: ' y\r\n' })
    expect(approveTaskOfferHandler(f.db, f.starsi, ok1, T2).ok).toBe(true)
    const ok2 = parseSeenScore({ templateId: tid, score: 10, seenDescription: 'y' })
    expect(approveTemplateScoreHandler(f.db, f.starsi, ok2, T2).ok).toBe(true)
  })
})

describe('parsers', () => {
  const target = { kind: 'task', id: 1 }
  it('parseDescriptionChange: a target and a string up to 4000 raw characters', () => {
    expect(parseDescriptionChange({ ...target, description: 'x' })).toEqual({
      target: { kind: 'task', id: 1 },
      description: 'x',
    })
    expect(parseDescriptionChange({ kind: 'template', id: 2, description: '' })).toEqual({
      target: { kind: 'template', id: 2 },
      description: '',
    })
    expect(
      parseDescriptionChange({ ...target, description: 'a'.repeat(4000) }).description,
    ).toHaveLength(4000)
  })
  it.each([
    { ...target, description: 'a'.repeat(4001) },
    { ...target, description: 5 },
    { ...target, description: null },
    { kind: 'task', id: 1.5, description: 'x' },
    { kind: 'task', id: '1', description: 'x' },
    { kind: 'chore', id: 1, description: 'x' },
    null,
    [],
  ])('parseDescriptionChange refuses %j', (input) => {
    expect(() => parseDescriptionChange(input)).toThrow('Invalid input')
  })
  it('parseDescriptionAnswer: a target, a change id and a yes or no', () => {
    expect(parseDescriptionAnswer({ ...target, changeId: 3, yes: false })).toEqual({
      target: { kind: 'task', id: 1 },
      changeId: 3,
      yes: false,
    })
  })
  it.each([
    { ...target, changeId: 3, yes: 'yes' },
    { ...target, changeId: 3 },
    { ...target, changeId: '3', yes: true },
    { kind: 'x', id: 1, changeId: 3, yes: true },
  ])('parseDescriptionAnswer refuses %j', (input) => {
    expect(() => parseDescriptionAnswer(input)).toThrow('Invalid input')
  })
  it('creates take an optional description up to 4000 raw characters', () => {
    const task = { title: 'x', score: 5, approvalRequired: true }
    const tpl = { ...task, schedule: null, deadline: null }
    expect(parseNewTask(task)).toEqual(task)
    expect(parseNewTask({ ...task, description: 'a'.repeat(4000) }).description).toHaveLength(4000)
    expect(() => parseNewTask({ ...task, description: 'a'.repeat(4001) })).toThrow('Invalid input')
    expect(() => parseNewTask({ ...task, description: 1 })).toThrow('Invalid input')
    expect(parseNewTemplate(tpl)).toEqual(tpl)
    expect(parseNewTemplate({ ...tpl, description: 'y' }).description).toBe('y')
    expect(() => parseNewTemplate({ ...tpl, description: 'a'.repeat(4001) })).toThrow(
      'Invalid input',
    )
  })
  it('seenDescription: a string up to 4000, null, or missing', () => {
    expect(parseTakerScore({ taskId: 1, score: 5 })).toStrictEqual({ taskId: 1, score: 5 })
    expect(parseTakerScore({ taskId: 1, score: 5, seenDescription: null })).toEqual({
      taskId: 1,
      score: 5,
      seenDescription: null,
    })
    expect(parseSeenScore({ templateId: 1, score: 5, seenDescription: 'x' })).toEqual({
      templateId: 1,
      score: 5,
      seenDescription: 'x',
    })
    for (const bad of ['a'.repeat(4001), 7]) {
      expect(() => parseTakerScore({ taskId: 1, score: 5, seenDescription: bad })).toThrow(
        'Invalid input',
      )
      expect(() => parseSeenScore({ templateId: 1, score: 5, seenDescription: bad })).toThrow(
        'Invalid input',
      )
    }
  })
})

describe('Domů: waiting description changes (ruling 6)', () => {
  it('a reserved task lists only for the reserver; an open task and a chore for every brother', () => {
    const f = family()
    on(f)
    const reserved = car(f)
    must(approveTaskOffer(f.db, f.starsi, reserved, 18, T0))
    must(reserveTask(f.db, f.starsi, reserved, T0, false))
    must(changeDescriptionOf(f.db, { kind: 'task', id: reserved }, f.tata, 'Jen obývák.', T1))
    const open = car(f)
    must(approveTaskOffer(f.db, f.mladsi, open, 18, T0))
    must(changeDescriptionOf(f.db, { kind: 'task', id: open }, f.tata, 'I chodba.', T1))
    const chore = agreedTemplate(f)
    must(changeDescriptionOf(f.db, { kind: 'template', id: chore }, f.tata, 'Hrnce ručně.', T1))
    const names = (id: number) => descriptionChangesWaitingHandler(f.db, id).map((r) => r.target)
    expect(names(f.starsi)).toEqual([
      { kind: 'task', id: reserved },
      { kind: 'task', id: open },
      { kind: 'template', id: chore },
    ])
    expect(names(f.mladsi)).toEqual([
      { kind: 'task', id: open },
      { kind: 'template', id: chore },
    ])
    const [first] = descriptionChangesWaitingHandler(f.db, f.starsi)
    expect(Object.keys(first ?? {}).sort()).toEqual(['changeId', 'name', 'score', 'target'])
  })

  it("a closed change and a parent's view list nothing", () => {
    const f = family()
    on(f)
    const id = car(f)
    must(approveTaskOffer(f.db, f.mladsi, id, 18, T0))
    must(changeDescriptionOf(f.db, { kind: 'task', id }, f.tata, 'I chodba.', T1))
    expect(descriptionChangesWaitingHandler(f.db, f.tata)).toEqual([])
    const change = getTaskDetail(f.db, id, { descriptions: true })?.descriptionChange
    const answer = { target: { kind: 'task', id } as const, changeId: change?.id ?? 0, yes: false }
    expect(answerDescriptionHandler(f.db, f.starsi, answer, T2).ok).toBe(true)
    expect(descriptionChangesWaitingHandler(f.db, f.starsi)).toEqual([])
  })

  it('switch off: nothing', () => {
    const f = family()
    on(f)
    const id = car(f)
    must(approveTaskOffer(f.db, f.mladsi, id, 18, T0))
    must(changeDescriptionOf(f.db, { kind: 'task', id }, f.tata, 'I chodba.', T1))
    setFlag(f, 'descriptions', false)
    expect(descriptionChangesWaitingHandler(f.db, f.starsi)).toEqual([])
  })
})
