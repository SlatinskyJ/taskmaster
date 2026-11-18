import { beforeEach, describe, expect, it, vi } from 'vitest'

// The challenge cookie (./http), with the framework's cookie helpers replaced by a recorder.
const jar = vi.hoisted(() => ({
  value: undefined as string | undefined,
  set: [] as { name: string; value: string; opts: unknown }[],
  deleted: [] as { name: string; opts: unknown }[],
}))
vi.mock('@tanstack/react-start/server', () => ({
  getCookie: (name: string) => (name === '__Host-tm_pk_challenge' ? jar.value : undefined),
  setCookie: (name: string, value: string, opts: unknown) => jar.set.push({ name, value, opts }),
  deleteCookie: (name: string, opts: unknown) => jar.deleted.push({ name, opts }),
}))

const { challengeToken, clearChallengeCookie, setChallengeCookie } = await import('./http')

beforeEach(() => {
  jar.value = undefined
  jar.set = []
  jar.deleted = []
})

describe('challenge cookie', () => {
  it('is __Host-, HttpOnly, Secure, SameSite=Strict, path /, five minutes', () => {
    setChallengeCookie('t')
    expect(jar.set).toEqual([
      {
        name: '__Host-tm_pk_challenge',
        value: 't',
        opts: { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 300 },
      },
    ])
  })

  it('reads back and clears', () => {
    jar.value = 'abc'
    expect(challengeToken()).toBe('abc')
    clearChallengeCookie()
    expect(jar.deleted).toEqual([
      {
        name: '__Host-tm_pk_challenge',
        opts: { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
      },
    ])
  })
})
