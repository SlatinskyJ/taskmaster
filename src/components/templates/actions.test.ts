import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { RecurringValue } from './actions'
import {
  approveOutcome,
  approveTemplate,
  DEFAULT_RECURRING,
  submitNewItem,
  toDefinition,
} from './actions'

const R = (change: Partial<RecurringValue>): RecurringValue => ({ ...DEFAULT_RECURRING, ...change })

describe('toDefinition', () => {
  it('no days → no schedule, whatever the time says', () => {
    expect(toDefinition(R({ days: [], time: '18:30' })).schedule).toBeNull()
  })

  it('Sunday, Saturday and minutes survive', () => {
    expect(toDefinition(R({ days: [0, 6], time: '18:30' })).schedule).toEqual({
      days: [0, 6],
      time: { hour: 18, minute: 30 },
    })
  })

  it('"V určitý čas" off → time null', () => {
    expect(toDefinition(R({ days: [2], withTime: false })).schedule).toEqual({
      days: [2],
      time: null,
    })
  })

  it('deadline off → null; on → day offset, due with minutes, grace in minutes', () => {
    expect(toDefinition(R({ hasDeadline: false })).deadline).toBeNull()
    expect(
      toDefinition(R({ hasDeadline: true, dayOffset: 1, dueTime: '07:45', graceHours: 2 }))
        .deadline,
    ).toEqual({ dayOffset: 1, due: { hour: 7, minute: 45 }, graceMinutes: 120 })
  })
})

const dataOf = (fn: { mock: { calls: unknown[][] } }) =>
  (fn.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data

describe('submitNewItem', () => {
  const form = {
    title: 'Vynést koše',
    score: 4,
    approvalRequired: true,
    recurring: R({ days: [2], time: '18:00', hasDeadline: true }),
    description: '',
  }
  const fns = () => ({
    createTask: vi.fn(() => Promise.resolve({ ok: true as const, id: 1 })),
    createTemplate: vi.fn(() => Promise.resolve({ ok: true as const, id: 2 })),
  })

  it('recurring → only createTemplate, with the definition', async () => {
    const f = fns()
    expect(await submitNewItem('recurring', form, f)).toEqual({ ok: true, id: 2 })
    expect(f.createTask).not.toHaveBeenCalled()
    expect(f.createTemplate).toHaveBeenCalledWith({
      data: {
        title: 'Vynést koše',
        score: 4,
        approvalRequired: true,
        ...toDefinition(form.recurring),
      },
    })
  })

  it('one-time → only createTask, with no recurring fields', async () => {
    const f = fns()
    expect(await submitNewItem('one_time', form, f)).toEqual({ ok: true, id: 1 })
    expect(f.createTemplate).not.toHaveBeenCalled()
    expect(f.createTask).toHaveBeenCalledWith({
      data: { title: 'Vynést koše', score: 4, approvalRequired: true },
    })
  })

  it.each(['one_time', 'recurring'] as const)(
    '%s with a description → it is in the call data',
    async (kind) => {
      const f = fns()
      await submitNewItem(kind, { ...form, description: 'Koše i tříděný.' }, f)
      const call = kind === 'one_time' ? f.createTask : f.createTemplate
      expect(dataOf(call)).toMatchObject({ description: 'Koše i tříděný.' })
    },
  )

  it.each(['one_time', 'recurring'] as const)(
    '%s with a blank description → no description key',
    async (kind) => {
      const f = fns()
      await submitNewItem(kind, { ...form, description: '  \n ' }, f)
      const call = kind === 'one_time' ? f.createTask : f.createTemplate
      expect(dataOf(call)).not.toHaveProperty('description')
    },
  )

  it('passes a refusal through', async () => {
    const f = fns()
    f.createTemplate.mockResolvedValueOnce({ ok: false, error: 'invalid_schedule' } as never)
    expect(await submitNewItem('recurring', form, f)).toEqual({
      ok: false,
      error: 'invalid_schedule',
    })
  })
})

describe('approveTemplate', () => {
  it('sends the template id and the score shown', async () => {
    const fn = vi.fn(() => Promise.resolve({ ok: true as const, id: 7 }))
    await approveTemplate({ id: 7, score: 4 }, fn)
    expect(fn).toHaveBeenCalledWith({ data: { templateId: 7, score: 4 } })
  })
})

describe('approveOutcome', () => {
  it.each([
    [
      { ok: true, id: 1 },
      { toast: 'success', message: cs.tasks.approved },
    ],
    [
      { ok: false, error: 'not_proposed' },
      { toast: 'error', message: cs.tasks.errors.gone },
    ],
    ['threw', { toast: 'error', message: cs.login.failed }],
  ] as const)('%j', (result, outcome) => {
    expect(approveOutcome(result)).toEqual(outcome)
  })
})
