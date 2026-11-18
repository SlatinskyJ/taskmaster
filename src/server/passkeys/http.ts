import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { CHALLENGE_TTL_MS } from './challenges'

// The challenge cookie: a random token that finds this browser's pending challenge (./challenges).
// `__Host-` makes the browser insist on Secure, Path=/ and no Domain. SameSite=Strict: the
// ceremony never starts from another site.

export const PASSKEY_CHALLENGE_COOKIE = '__Host-tm_pk_challenge'

const OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const

export function setChallengeCookie(token: string): void {
  setCookie(PASSKEY_CHALLENGE_COOKIE, token, { ...OPTIONS, maxAge: CHALLENGE_TTL_MS / 1000 })
}

export function challengeToken(): string | undefined {
  return getCookie(PASSKEY_CHALLENGE_COOKIE)
}

export function clearChallengeCookie(): void {
  deleteCookie(PASSKEY_CHALLENGE_COOKIE, OPTIONS)
}
