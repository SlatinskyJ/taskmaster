import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { getRequestHeader } from '@tanstack/react-start/server'
import type { CurrentUser } from '~/server/auth'
import { clientIp, setSessionCookie } from '~/server/auth/http'
import { getDb } from '~/server/db'
import { passkeyConfig } from './config'
import { challengeToken, clearChallengeCookie, setChallengeCookie } from './http'
import { finishPasskeyLogin, startPasskeyLogin } from './login'
import type { PasskeyLoginError } from './login'
import { countPasskeysByUser, listPasskeys, removePasskey, removeUserPasskeys } from './manage'
import { finishRegistration, startRegistration } from './register'
import type { PasskeySummary, RegisterError } from './register'

// The bodies of the passkey server functions (./functions), as plain functions so tests can
// call them with a fake request. Each answers `disabled` when passkeys are off (no
// WEBAUTHN_RP_ID); listing and removing work either way. Replies hold no secrets: the session
// token goes to the cookie only.

interface Off {
  ok: false
  error: 'disabled'
}
const OFF: Off = { ok: false, error: 'disabled' }

/**
 * The WebAuthn options as a JSON string: their library types are not plain enough for the
 * server-function serializer. The browser parses them and hands them to @simplewebauthn/browser.
 */
export type OptionsResult = { ok: true; optionsJson: string } | Off | { ok: false; error: 'busy' }
export type PasskeyLoginResult =
  { ok: true; user: CurrentUser } | Off | { ok: false; error: PasskeyLoginError }
export type PasskeyRegisterResult =
  { ok: true; passkey: PasskeySummary } | Off | { ok: false; error: RegisterError }

export function passkeysEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return passkeyConfig(env) !== null
}

export async function passkeyLoginOptions(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<OptionsResult> {
  const config = passkeyConfig(env)
  if (!config) return OFF
  const started = await startPasskeyLogin(getDb(), clientIp(env), config, now)
  if (!started.ok) return started
  setChallengeCookie(started.value.token)
  return { ok: true, optionsJson: JSON.stringify(started.value.options) }
}

/** `response` is already checked by the server function's validator (./parse). */
export async function passkeyLogin(
  response: AuthenticationResponseJSON,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<PasskeyLoginResult> {
  const config = passkeyConfig(env)
  if (!config) return OFF
  const token = challengeToken()
  if (!token) return { ok: false, error: 'expired_challenge' }
  clearChallengeCookie()
  const result = await finishPasskeyLogin(
    getDb(),
    { token, response, ip: clientIp(env) },
    config,
    now,
  )
  if (!result.ok) return result
  setSessionCookie(result.value.token, result.value.expiresAt)
  return { ok: true, user: result.value.user }
}

export async function passkeyRegisterOptions(
  user: CurrentUser,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<OptionsResult> {
  const config = passkeyConfig(env)
  if (!config) return OFF
  const started = await startRegistration(getDb(), user, config, now)
  if (!started.ok) return started
  setChallengeCookie(started.value.token)
  return { ok: true, optionsJson: JSON.stringify(started.value.options) }
}

export async function passkeyRegister(
  user: CurrentUser,
  response: RegistrationResponseJSON,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<PasskeyRegisterResult> {
  const config = passkeyConfig(env)
  if (!config) return OFF
  const token = challengeToken()
  if (!token) return { ok: false, error: 'expired_challenge' }
  clearChallengeCookie()
  const result = await finishRegistration(
    getDb(),
    user,
    { token, response, userAgent: getRequestHeader('user-agent') },
    config,
    now,
  )
  if (!result.ok) return result
  return { ok: true, passkey: result.value }
}

export function listMyPasskeys(user: CurrentUser): PasskeySummary[] {
  return listPasskeys(getDb(), user.id)
}

export function removeMyPasskey(
  user: CurrentUser,
  passkeyId: number,
  now: Date = new Date(),
): { ok: true } | { ok: false; error: 'not_found' } {
  const result = removePasskey(getDb(), user, passkeyId, now)
  return result.ok ? { ok: true } : result
}

export function listPasskeyCounts(): Record<number, number> {
  return countPasskeysByUser(getDb())
}

export function removeAllPasskeysOf(
  admin: CurrentUser,
  userId: number,
  now: Date = new Date(),
): { removed: number } {
  return { removed: removeUserPasskeys(getDb(), admin, userId, now) }
}
