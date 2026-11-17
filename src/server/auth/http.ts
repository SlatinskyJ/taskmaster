import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from '@tanstack/react-start/server'
import { getDb } from '~/server/db'
import type { CurrentUser } from './sessions'
import { resolveSession } from './sessions'
import { pickClientIp } from './clientIp'

// The glue between the auth module and the HTTP request: the session cookie and the client IP.
// Only server code imports this (server functions, route loaders via server functions).

/**
 * `__Host-` makes the browser insist on Secure, Path=/ and no Domain, so a sibling subdomain
 * can't plant or read it. Browsers accept Secure cookies on http://localhost, so dev works.
 */
export const SESSION_COOKIE = '__Host-tm_session'

export function setSessionCookie(token: string, expiresAt: Date): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(): void {
  deleteCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
}

export function sessionToken(): string | undefined {
  return getCookie(SESSION_COOKIE)
}

/**
 * The signed-in user of the current request, or null. Renews the cookie when the sliding
 * expiry moved. Use it in server functions; route guards build on it (#28).
 */
export function currentUser(now: Date = new Date()): CurrentUser | null {
  const token = sessionToken()
  if (!token) return null
  const resolved = resolveSession(getDb(), token, now)
  if (!resolved) {
    clearSessionCookie()
    return null
  }
  if (resolved.renewed) setSessionCookie(token, new Date(resolved.session.expiresAt))
  return resolved.user
}

/**
 * The client's IP for the rate limit. Behind a reverse proxy every request comes from the
 * proxy, so with `TRUST_PROXY=1` the last `X-Forwarded-For` entry is used: the one our own
 * proxy appended (entries left of it are whatever the client sent, and can be forged).
 */
export function clientIp(env: NodeJS.ProcessEnv = process.env): string {
  return pickClientIp(
    env.TRUST_PROXY === '1' ? getRequestHeader('x-forwarded-for') : undefined,
    getRequestIP(),
  )
}
