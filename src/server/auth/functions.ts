import { createServerFn } from '@tanstack/react-start'
import { getDb } from '~/server/db'
import { clearSessionCookie, clientIp, currentUser, sessionToken, setSessionCookie } from './http'
import { login, logout } from './login'
import type { LoginError } from './login'
import type { CurrentUser } from './sessions'

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

export type LoginResult = { ok: true; user: CurrentUser } | { ok: false; error: LoginError }

export const loginFn = createServerFn({ method: 'POST' })
  .validator(parseLoginForm)
  .handler(async ({ data }): Promise<LoginResult> => {
    const result = await login(getDb(), { ...data, ip: clientIp() })
    if (!result.ok) return result
    setSessionCookie(result.value.token, result.value.expiresAt)
    return { ok: true, user: result.value.user }
  })

export const logoutFn = createServerFn({ method: 'POST' }).handler(() => {
  const token = sessionToken()
  if (token) logout(getDb(), token)
  clearSessionCookie()
})

/** Who is signed in, or null. Loaders call it; it never throws for a missing session. */
export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(() => currentUser())
