import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { sendDispute } from './disputeCalls'

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
