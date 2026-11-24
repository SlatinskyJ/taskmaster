import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { sendDismiss, sendDispute } from './disputeCalls'

// The one place the dispute drawer reaches the server (#46).
const input = { kind: 'completion', id: 10, reason: 'Byl i kufr.' } as const

describe('sendDispute', () => {
  it('sends exactly { data: { kind, id, reason } } and answers null on success', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const }))
    await expect(sendDispute(call, input)).resolves.toBeNull()
    expect(call).toHaveBeenCalledWith({ data: input })
  })

  it('a refusal answers its Czech message', async () => {
    const call = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'dispute_open' as const }),
    )
    await expect(sendDispute(call, input)).resolves.toBe('Už je rozporováno.')
  })

  it('a failed request answers the generic message', async () => {
    const call = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(sendDispute(call, input)).resolves.toBe(cs.disputes.errors.generic)
  })
})

describe('sendDismiss (#47)', () => {
  const dismiss = { id: 4, value: { score: 8 }, note: 'Sedí.' }
  const e = cs.admin.disputes.errors

  it('sends exactly { data: { id, value, note } } and answers ok', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const }))
    await expect(sendDismiss(call, dismiss)).resolves.toEqual({ ok: true })
    expect(call).toHaveBeenCalledWith({ data: dismiss })
  })

  it.each([
    ['value_changed', e.value_changed],
    ['not_open', e.not_open],
    ['not_found', e.not_found],
  ] as const)('%s closes the dialog and reloads the list', async (error, message) => {
    const call = vi.fn(() => Promise.resolve({ ok: false as const, error }))
    await expect(sendDismiss(call, dismiss)).resolves.toEqual({ ok: false, message, reload: true })
  })

  it('note_required stays in the dialog', async () => {
    const call = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'note_required' as const }),
    )
    await expect(sendDismiss(call, dismiss)).resolves.toEqual({
      ok: false,
      message: e.note_required,
      reload: false,
    })
  })

  it('a thrown call gives the generic text and stays in the dialog', async () => {
    const call = vi.fn(() => Promise.reject(new Error('net')))
    await expect(sendDismiss(call, dismiss)).resolves.toEqual({
      ok: false,
      message: cs.disputes.errors.generic,
      reload: false,
    })
  })
})
