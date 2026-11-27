import type { FrameLoginResult } from '~/server/auth/frameLogin'
import type { DemoLogin } from './demoAccounts'
import type { Device } from './multiLayout'

// Logging one viewer frame in (/dev/multi): the frame gets its own session from frameLoginFn.
// A refusal or a failed call fails that frame only; the page offers a retry.

export type FrameStatus = { kind: 'loggingIn' } | { kind: 'ready' } | { kind: 'failed' }

export async function logInDevice(
  device: Device,
  login: (username: DemoLogin) => Promise<FrameLoginResult>,
): Promise<{ device: Device; status: FrameStatus }> {
  try {
    const result = await login(device.user)
    if (result.ok) return { device: { ...device, token: result.token }, status: { kind: 'ready' } }
  } catch {
    // Network or server error: the same as a refusal for the person looking at the frame.
  }
  return { device, status: { kind: 'failed' } }
}
