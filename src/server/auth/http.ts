import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  getRequestUrl,
  setCookie,
} from '@tanstack/react-start/server'
import { FRAME_HEADER, FRAME_QUERY } from '~/lib/frame'
import { getDb } from '~/server/db'
import type { CurrentUser } from './sessions'
import { resolveSession } from './sessions'
import { pickClientIp } from './clientIp'
import { readFrame } from './frame'
import type { FrameRequest } from './frame'
import { login, logout } from './login'
import type { LoginError } from './login'

// The glue between the auth module and the HTTP request: the session cookie and the client IP.
// Only server code imports this (server functions, route loaders via server functions).
//
// On dev and PR previews a request from a viewer frame (./frame) carries its own session token
// and never reads, sets or clears the cookie: every cookie access below goes through it.

/**
 * `__Host-` makes the browser insist on Secure, Path=/ and no Domain, so a sibling subdomain
 * can't plant or read it. Browsers accept Secure cookies on http://localhost, so dev works.
 */
export const SESSION_COOKIE = '__Host-tm_session'

function setSessionCookie(token: string, expiresAt: Date): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

function clearSessionCookie(): void {
  deleteCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
}

/** Whether this request comes from a viewer frame, and its token. Never a frame in production. */
export function requestFrame(env: NodeJS.ProcessEnv = process.env): FrameRequest {
  return readFrame(env, {
    header: getRequestHeader(FRAME_HEADER),
    query: getRequestUrl().searchParams.get(FRAME_QUERY) ?? undefined,
    fetchDest: getRequestHeader('sec-fetch-dest'),
  })
}

/** The request's session token: a frame's own, else the cookie's. */
export function sessionToken(): string | undefined {
  const frame = requestFrame()
  return frame.inFrame ? frame.token : getCookie(SESSION_COOKIE)
}

/**
 * After a login: outside a frame the token goes to the cookie; in a frame it goes back to the
 * caller as `frameToken`, and the cookie stays as it was.
 */
export function startSession(token: string, expiresAt: Date): { frameToken?: string } {
  if (requestFrame().inFrame) return { frameToken: token }
  setSessionCookie(token, expiresAt)
  return {}
}

/** After a logout: clears the cookie, except in a frame (the frame forgets its own token). */
export function endSession(): void {
  if (requestFrame().inFrame) return
  clearSessionCookie()
}

/**
 * The signed-in user of the current request, or null. Renews the cookie when the sliding
 * expiry moved. In a frame the frame's token decides, and the cookie is neither read, renewed
 * nor cleared. Use it in server functions; route guards build on it (#28).
 */
export function currentUser(now: Date = new Date()): CurrentUser | null {
  const frame = requestFrame()
  const token = frame.inFrame ? frame.token : getCookie(SESSION_COOKIE)
  if (!token) return null
  const resolved = resolveSession(getDb(), token, now)
  if (!resolved) {
    if (!frame.inFrame) clearSessionCookie()
    return null
  }
  if (resolved.renewed && !frame.inFrame) {
    setSessionCookie(token, new Date(resolved.session.expiresAt))
  }
  return resolved.user
}

export type LoginResult =
  { ok: true; user: CurrentUser; frameToken?: string } | { ok: false; error: LoginError }

/** `loginFn`'s body: password login, then the cookie (or, in a frame, the token back). */
export async function passwordLogin(input: {
  username: string
  password: string
}): Promise<LoginResult> {
  const result = await login(getDb(), { ...input, ip: clientIp() })
  if (!result.ok) return result
  const started = startSession(result.value.token, result.value.expiresAt)
  return { ok: true, user: result.value.user, ...started }
}

/** `logoutFn`'s body: ends this request's session (a frame's own one in a frame). */
export function logoutHere(): void {
  const token = sessionToken()
  if (token) logout(getDb(), token)
  endSession()
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
