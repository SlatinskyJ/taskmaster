import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import {
  answerDescription,
  canEditDescription,
  descriptionToast,
  sendDescription,
} from './descriptionCalls'

// The one place the description sheet and the waiting card reach the server (#207).
// Every status and origin: a Record makes the typecheck fail when the schema adds one.
const STATUS: Record<TaskView['status'], true> = {
  proposed: true,
  open: true,
  reserved: true,
  done_unconfirmed: true,
  confirmed: true,
  cancelled: true,
  expired: true,
  rejected: true,
}
const ORIGIN: Record<TaskView['origin'], true> = {
  one_time: true,
  on_demand: true,
  self_logged: true,
  scheduled: true,
}
const TASK_STATUSES = Object.keys(STATUS) as TaskView['status'][]
const TASK_ORIGINS = Object.keys(ORIGIN) as TaskView['origin'][]

const target = { kind: 'task', id: 7 } as const
const giver = { id: 1, role: 'giver' } as const
const taker = { id: 3, role: 'taker' } as const
const admin = { id: 9, role: 'admin' } as const

describe('sendDescription', () => {
  it.each(['applied', 'waiting', 'withdrawn'] as const)(
    'sends { data: { kind, id, description } } and passes outcome %s on',
    async (outcome) => {
      const fn = vi.fn(() => Promise.resolve({ ok: true as const, outcome }))
      await expect(sendDescription(target, 'I kufr.', fn)).resolves.toEqual({ ok: true, outcome })
      expect(fn).toHaveBeenCalledWith({ data: { kind: 'task', id: 7, description: 'I kufr.' } })
    },
  )

  it.each([
    ['description_too_long', 'Popis je delší než 1000 znaků.'],
    ['description_frozen', 'Popis už nejde změnit.'],
    ['not_changeable', 'Tady popis měnit nemůžeš.'],
    ['same_description', 'Popis je stejný jako teď.'],
    ['offer_changed', cs.tasks.errors.offerChanged],
    ['feature_off', cs.tasks.errors.notAllowed],
  ] as const)('a refusal %s answers its Czech message', async (error, message) => {
    const fn = vi.fn(() => Promise.resolve({ ok: false as const, error }))
    await expect(sendDescription(target, 'x', fn)).resolves.toEqual({ ok: false, error: message })
  })

  it('a failed request answers the generic message', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(sendDescription(target, 'x', fn)).resolves.toEqual({
      ok: false,
      error: cs.login.failed,
    })
  })
})

describe('answerDescription', () => {
  it.each([
    [true, 'agreed'],
    [false, 'declined'],
  ] as const)('yes=%s sends { kind, id, changeId, yes } and passes %s on', async (yes, outcome) => {
    const fn = vi.fn(() => Promise.resolve({ ok: true as const, outcome }))
    await expect(answerDescription(target, 4, yes, fn)).resolves.toEqual({ ok: true, outcome })
    expect(fn).toHaveBeenCalledWith({ data: { kind: 'task', id: 7, changeId: 4, yes } })
  })

  it.each([
    ['no_change', 'Návrh už neplatí. Podívej se znovu.'],
    ['not_involved', 'Tenhle návrh neodsouhlasuješ ty.'],
  ] as const)('a refusal %s answers its Czech message', async (error, message) => {
    const fn = vi.fn(() => Promise.resolve({ ok: false as const, error }))
    await expect(answerDescription(target, 4, true, fn)).resolves.toEqual({
      ok: false,
      error: message,
    })
  })

  it('a failed request answers the generic message', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(answerDescription(target, 4, false, fn)).resolves.toEqual({
      ok: false,
      error: cs.login.failed,
    })
  })
})

describe('descriptionToast', () => {
  it.each([
    ['applied', 'Popis uložen.'],
    ['waiting', 'Popis čeká na souhlas kluků.'],
    ['withdrawn', 'Návrh popisu vzat zpět.'],
    ['agreed', 'Nový popis platí.'],
    ['declined', 'Zůstává starý popis.'],
  ] as const)('%s → %s', (outcome, toast) => {
    expect(descriptionToast(outcome)).toBe(toast)
  })
})

describe('canEditDescription (ruling 4)', () => {
  const editable = new Set(['proposed', 'open', 'reserved'])

  it.each(TASK_STATUSES)('a giver on a one-time task, status %s', (status) => {
    const item = { kind: 'task', status, origin: 'one_time' } as const
    expect(canEditDescription(item, giver)).toBe(editable.has(status))
    expect(canEditDescription(item, taker)).toBe(false)
    expect(canEditDescription(item, admin)).toBe(false)
  })

  it.each(TASK_ORIGINS.filter((o) => o !== 'one_time'))('nobody on an instance (%s)', (origin) => {
    for (const status of TASK_STATUSES) {
      expect(canEditDescription({ kind: 'task', status, origin }, giver)).toBe(false)
    }
  })

  it('a giver on any chore; never a brother or the admin', () => {
    const item = { kind: 'template' } as const
    expect(canEditDescription(item, giver)).toBe(true)
    expect(canEditDescription(item, taker)).toBe(false)
    expect(canEditDescription(item, admin)).toBe(false)
  })
})
