import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '~/server/db/testing'
import type { Db } from '~/server/db'
import { createUser } from '~/server/users'
import { seedDemo } from '~/server/demo'
import { users } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { createSession, RENEW_AFTER_MS, resolveSession } from './sessions'

// The cookie and IP glue around the request (./http), with the framework's request helpers
// replaced by a fake request.
interface FakeRequest {
  cookie: string | undefined
  headers: Record<string, string>
  url: string
  socketIp: string | undefined
  set: { token: string; expires: Date | undefined }[]
  deleted: number
  db: Db | undefined
}
const req = vi.hoisted((): FakeRequest => ({
  cookie: undefined,
  headers: {},
  url: 'https://x/',
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
  getRequestUrl: () => new URL(req.url),
}))
vi.mock('~/server/db', () => ({ getDb: () => req.db }))

const { clientIp, currentUser, endSession, logoutHere, passwordLogin, sessionToken, startSession } =
  await import('./http')

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
  req.url = 'https://x/'
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

// The demo family (password demo1234), with sessions for tata (the page's cookie) and starsi
// (a frame's token).
function family(): { db: Db; tata: string; starsi: string } {
  const db = createTestDb()
  const seeded = seedDemo(db, { TASKMASTER_ENV: 'preview', TASKMASTER_SEED: 'family' }, T0)
  if (seeded.kind !== 'seeded') throw new Error(seeded.reason)
  const id = (username: string) =>
    db.select().from(users).where(eq(users.username, username)).get()?.id ?? 0
  req.db = db
  return {
    db,
    tata: createSession(db, id('tata'), 'password', T0).token,
    starsi: createSession(db, id('starsi'), 'password', T0).token,
  }
}

describe('in a viewer frame (preview)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TASKMASTER_ENV', 'preview')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the frame token, not the cookie', () => {
    const f = family()
    req.cookie = f.tata
    req.headers['x-tm-frame'] = f.starsi
    expect(currentUser(T0)?.username).toBe('starsi')
    expect(req.set).toEqual([])
    expect(req.deleted).toBe(0)
  })

  it('a frame with no token is nobody, and the cookie stays', () => {
    const f = family()
    req.cookie = f.tata
    req.headers['x-tm-frame'] = ''
    expect(currentUser(T0)).toBeNull()
    req.headers['x-tm-frame'] = '-'
    expect(currentUser(T0)).toBeNull()
    expect(req.deleted).toBe(0)
    expect(req.set).toEqual([])
  })

  it('a dead frame token is nobody, and the cookie is not cleared', () => {
    const f = family()
    req.cookie = f.tata
    req.headers['x-tm-frame'] = 'x'.repeat(43)
    expect(currentUser(T0)).toBeNull()
    expect(req.deleted).toBe(0)
  })

  it('renewal in a frame writes no cookie', () => {
    const f = family()
    req.headers['x-tm-frame'] = f.starsi
    expect(currentUser(new Date(T0.getTime() + RENEW_AFTER_MS))?.username).toBe('starsi')
    expect(req.set).toEqual([])
  })

  it('startSession in a frame returns the token and sets no cookie', () => {
    req.headers['x-tm-frame'] = '-'
    expect(startSession('tok', T0)).toEqual({ frameToken: 'tok' })
    expect(req.set).toEqual([])
  })

  it('outside a frame startSession sets the cookie and returns {}', () => {
    expect(startSession('tok', T0)).toEqual({})
    expect(req.set).toEqual([{ token: 'tok', expires: T0 }])
  })

  it('endSession in a frame leaves the cookie', () => {
    req.headers['x-tm-frame'] = 'abc'
    endSession()
    expect(req.deleted).toBe(0)
    delete req.headers['x-tm-frame']
    endSession()
    expect(req.deleted).toBe(1)
  })

  it('sessionToken() is the frame token in a frame', () => {
    req.cookie = 'cookie-token'
    req.headers['x-tm-frame'] = 'frame-token'
    expect(sessionToken()).toBe('frame-token')
    req.headers['x-tm-frame'] = '-'
    expect(sessionToken()).toBeUndefined()
  })

  it('a document load with ?tmFrame uses that token', () => {
    const f = family()
    req.cookie = f.tata
    req.url = `https://x/?tmFrame=${f.starsi}`
    expect(currentUser(T0)?.username).toBe('starsi')
    expect(req.set).toEqual([])
    expect(req.deleted).toBe(0)
  })

  it('an iframe load with no header or query is nobody, cookie untouched', () => {
    const f = family()
    req.cookie = f.tata
    req.headers['sec-fetch-dest'] = 'iframe'
    expect(currentUser(T0)).toBeNull()
    expect(req.deleted).toBe(0)
  })

  it('passwordLogin in a frame returns frameToken and sets no cookie', async () => {
    const f = family()
    req.headers['x-tm-frame'] = '-'
    const result = await passwordLogin({ username: 'starsi', password: 'demo1234' })
    if (!result.ok) throw new Error(result.error)
    expect(result.user.username).toBe('starsi')
    expect(result.frameToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(resolveSession(f.db, result.frameToken ?? '', new Date())?.user.username).toBe('starsi')
    expect(req.set).toEqual([])
  })

  it('passwordLogin outside a frame sets the cookie and has no frameToken key', async () => {
    family()
    const result = await passwordLogin({ username: 'starsi', password: 'demo1234' })
    expect(Object.keys(result).sort()).toEqual(['ok', 'user'])
    expect(req.set).toHaveLength(1)
  })

  it('logoutHere in a frame ends that session only and leaves the cookie', () => {
    const f = family()
    req.cookie = f.tata
    req.headers['x-tm-frame'] = f.starsi
    logoutHere()
    expect(resolveSession(f.db, f.starsi, T0)).toBeNull()
    expect(resolveSession(f.db, f.tata, T0)?.user.username).toBe('tata')
    expect(req.deleted).toBe(0)
  })

  it('production: the frame header is ignored', () => {
    vi.stubEnv('TASKMASTER_ENV', '')
    const f = family()
    req.cookie = f.tata
    req.headers['x-tm-frame'] = f.starsi
    req.url = `https://x/?tmFrame=${f.starsi}`
    req.headers['sec-fetch-dest'] = 'iframe'
    expect(currentUser(T0)?.username).toBe('tata')
    expect(sessionToken()).toBe(f.tata)
    expect(startSession('tok', T0)).toEqual({})
    expect(req.set).toHaveLength(1)
    endSession()
    expect(req.deleted).toBe(1)
  })
})
