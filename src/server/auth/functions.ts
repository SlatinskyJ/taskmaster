import { createServerFn } from '@tanstack/react-start'
import { getDb } from '~/server/db'
import { frameLogin } from './frameLogin'
import type { FrameLoginResult } from './frameLogin'
import { clientIp, currentUser, logoutHere, passwordLogin } from './http'
import type { LoginResult } from './http'

export type { LoginResult } from './http'
export type { FrameLoginResult } from './frameLogin'

// Server functions the login screen (#31) and the app shell call.

export interface LoginForm {
  username: string
  password: string
}

function parseLoginForm(data: unknown): LoginForm {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid login form')
  const { username, password } = data as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('Invalid login form')
  }
  return { username, password }
}

/** Outside a viewer frame the session goes to the cookie; in one, back as `frameToken` (./http). */
export const loginFn = createServerFn({ method: 'POST' })
  .validator(parseLoginForm)
  .handler(({ data }): Promise<LoginResult> => passwordLogin(data))

export const logoutFn = createServerFn({ method: 'POST' }).handler(() => {
  logoutHere()
})

function parseFrameLogin(data: unknown): { username: string } {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid frame login')
  const { username } = data as Record<string, unknown>
  if (typeof username !== 'string') throw new Error('Invalid frame login')
  return { username }
}

/**
 * The multi-user viewer logs a demo user in for one frame (./frameLogin). Dev and previews
 * only; sets no cookie and returns the token for the frame to keep.
 */
export const frameLoginFn = createServerFn({ method: 'POST' })
  .validator(parseFrameLogin)
  .handler(({ data }): Promise<FrameLoginResult> =>
    frameLogin(getDb(), process.env, data.username, clientIp()),
  )

/** Who is signed in, or null. Loaders call it; it never throws for a missing session. */
export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(() => currentUser())
