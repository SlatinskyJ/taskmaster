import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '~/server/db/testing'
import type { Db } from '~/server/db'
import { createUser } from '~/server/users'
import { createSession, RENEW_AFTER_MS } from './sessions'

// The cookie and IP glue around the request (./http), with the framework's request helpers
// replaced by a fake request.
interface FakeRequest {
  cookie: string | undefined
  headers: Record<string, string>
  socketIp: string | undefined
  set: { token: string; expires: Date | undefined }[]
  deleted: number
  db: Db | undefined
}
const req = vi.hoisted((): FakeRequest => ({
  cookie: undefined,
  headers: {},
  socketIp: '10.0.0.2',
  set: [],
  deleted: 0,
  db: undefined,
}))
vi.mock('@tanstack/react-start/server', () => ({
  getCookie: () => req.cookie,
  setCookie: (_name: string, token: string, opts: { expires?: Date }) =>
    req.set.push({ token, expires: opts.expires }),
  deleteCookie: () => {
    req.deleted++
  },
  getRequestHeader: (name: string) => req.headers[name],
  getRequestIP: () => req.socketIp,
}))
vi.mock('~/server/db', () => ({ getDb: () => req.db }))

const { clientIp, currentUser } = await import('./http')

const T0 = new Date('2026-11-17T10:00:00.000Z')

function signedIn(): { db: Db; token: string } {
  const db = createTestDb()
  const u = createUser(
    db,
    { kind: 'system' },
    { username: 'tata', displayName: 'Táta', role: 'giver' },
    T0,
  )
  if (!u.ok) throw new Error(u.error)
  const { token } = createSession(db, u.value.id, 'password', T0)
  req.db = db
  req.cookie = token
  return { db, token }
}

beforeEach(() => {
  req.cookie = undefined
  req.headers = {}
  req.socketIp = '10.0.0.2'
  req.set = []
  req.deleted = 0
})

describe('currentUser and the session cookie', () => {
  it('no cookie: nobody, cookie untouched', () => {
    expect(currentUser(T0)).toBeNull()
    expect(req.set).toEqual([])
    expect(req.deleted).toBe(0)
  })

  it('a fresh session: the user, no cookie write', () => {
    signedIn()
    expect(currentUser(new Date(T0.getTime() + 1000))?.username).toBe('tata')
    expect(req.set).toEqual([])
  })

  it('a renewed session re-sends the cookie with the new expiry', () => {
    const { token } = signedIn()
    const later = new Date(T0.getTime() + RENEW_AFTER_MS)
    expect(currentUser(later)?.username).toBe('tata')
    expect(req.set).toEqual([{ token, expires: new Date(later.getTime() + 90 * 24 * 3600 * 1000) }])
  })

  it('a dead or unknown token clears the cookie', () => {
    signedIn()
    req.cookie = 'x'.repeat(43)
    expect(currentUser(T0)).toBeNull()
    expect(req.deleted).toBe(1)
  })
})

describe('clientIp', () => {
  it('ignores X-Forwarded-For unless TRUST_PROXY=1', () => {
    req.headers['x-forwarded-for'] = '6.6.6.6, 203.0.113.7'
    expect(clientIp({})).toBe('10.0.0.2')
    expect(clientIp({ TRUST_PROXY: 'yes' })).toBe('10.0.0.2')
    expect(clientIp({ TRUST_PROXY: '1' })).toBe('203.0.113.7')
  })
})
