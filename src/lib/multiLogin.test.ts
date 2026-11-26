import { describe, expect, it } from 'vitest'
import type { FrameLoginResult } from '~/server/auth/frameLogin'
import type { Device } from './multiLayout'
import { logInDevice } from './multiLogin'

const device: Device = { id: 'd2', user: 'starsi', size: 'phone', path: '/', token: undefined }

const ok: FrameLoginResult = {
  ok: true,
  token: 'tok',
  user: { id: 3, username: 'starsi', displayName: 'Starší', role: 'taker' },
}

describe('logInDevice', () => {
  it('logs the frame in as its user and keeps the token', async () => {
    const asked: string[] = []
    const result = await logInDevice(device, (username) => {
      asked.push(username)
      return Promise.resolve(ok)
    })
    expect(asked).toEqual(['starsi'])
    expect(result).toEqual({ device: { ...device, token: 'tok' }, status: { kind: 'ready' } })
  })

  it('a refused login fails the frame and leaves its token unset', async () => {
    const result = await logInDevice(device, () =>
      Promise.resolve<FrameLoginResult>({ ok: false, error: 'rate_limited' }),
    )
    expect(result).toEqual({ device, status: { kind: 'failed' } })
    expect(result.device.token).toBeUndefined()
  })

  it('a thrown login (network, server error) fails the frame', async () => {
    const result = await logInDevice(device, () => Promise.reject(new Error('500')))
    expect(result).toEqual({ device, status: { kind: 'failed' } })
  })
})
