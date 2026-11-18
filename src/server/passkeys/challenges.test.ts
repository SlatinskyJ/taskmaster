import { describe, expect, it } from 'vitest'
import { hashToken } from '~/server/auth/sessions'
import { createTestDb } from '~/server/db/testing'
import type { Db } from '~/server/db'
import { passkeyChallenges } from '~/server/db/schema'
import { createUser } from '~/server/users'
import {
  CHALLENGE_TTL_MS,
  consumeChallenge,
  ipPrefix,
  issueChallenge,
  MAX_LOGIN_CHALLENGES,
  MAX_LOGIN_CHALLENGES_PER_IP,
  MAX_REGISTER_CHALLENGES_PER_USER,
} from './challenges'

const T0 = new Date('2026-11-18T10:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const IP_A = '203.0.113.7'
const IP_B = '198.51.100.9'

function setup(): { db: Db; tata: number; starsi: number } {
  const db = createTestDb()
  const make = (username: string) => {
    const r = createUser(
      db,
      { kind: 'system' },
      { username, displayName: username, role: 'taker' },
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    return r.value.id
  }
  return { db, tata: make('tata'), starsi: make('starsi') }
}

const rows = (db: Db) => db.select().from(passkeyChallenges).all()
const login = (db: Db, ip = IP_A, now = T0) => issueChallenge(db, { purpose: 'login', ip }, now)
const register = (db: Db, userId: number, now = T0) =>
  issueChallenge(db, { purpose: 'register', userId, userHandle: `h${String(userId)}` }, now)

function must<T>(v: T | null): T {
  if (v === null) throw new Error('null')
  return v
}

describe('issue and consume (single use)', () => {
  it('a login challenge comes back once, then the table is empty', () => {
    const { db } = setup()
    const { token, challenge } = must(login(db))
    expect(consumeChallenge(db, token, 'login', at(1))).toEqual({
      challenge,
      userId: null,
      userHandle: null,
    })
    expect(rows(db)).toEqual([])
    expect(consumeChallenge(db, token, 'login', at(2))).toBeNull()
  })

  it('a register challenge carries its user and user handle', () => {
    const { db, tata } = setup()
    const { token } = must(register(db, tata))
    expect(consumeChallenge(db, token, 'register', at(1))).toMatchObject({
      userId: tata,
      userHandle: `h${String(tata)}`,
    })
  })

  it('the wrong purpose gets null and the row is gone', () => {
    const { db, tata } = setup()
    const { token } = must(register(db, tata))
    expect(consumeChallenge(db, token, 'login', at(1))).toBeNull()
    expect(rows(db)).toEqual([])
    expect(consumeChallenge(db, token, 'register', at(2))).toBeNull()
  })

  it('expires exactly at the TTL, and the expired row is gone', () => {
    const { db } = setup()
    const a = must(login(db))
    expect(consumeChallenge(db, a.token, 'login', at(CHALLENGE_TTL_MS - 1))).not.toBeNull()
    const b = must(login(db))
    expect(consumeChallenge(db, b.token, 'login', at(CHALLENGE_TTL_MS))).toBeNull()
    expect(rows(db)).toEqual([])
  })

  it('unknown and malformed tokens get null', () => {
    const { db } = setup()
    must(login(db))
    expect(consumeChallenge(db, 'A'.repeat(43), 'login', T0)).toBeNull()
    expect(consumeChallenge(db, 'x', 'login', T0)).toBeNull()
    expect(consumeChallenge(db, 'A'.repeat(44), 'login', T0)).toBeNull()
    expect(rows(db)).toHaveLength(1)
  })

  it('stores neither the token nor the IP', () => {
    const { db } = setup()
    const { token } = must(login(db))
    const [row] = rows(db)
    expect(row?.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(rows(db))).not.toContain(token)
    expect(JSON.stringify(rows(db))).not.toContain(IP_A)
  })
})

describe('caps', () => {
  it(`at most ${String(MAX_LOGIN_CHALLENGES_PER_IP)} live login challenges per IP`, () => {
    const { db } = setup()
    for (let i = 0; i < MAX_LOGIN_CHALLENGES_PER_IP - 1; i++) must(login(db))
    expect(login(db)).not.toBeNull()
    expect(login(db)).toBeNull()
    expect(login(db, IP_B)).not.toBeNull()
  })

  it('two IPv6 addresses in one /64 share the per-IP cap', () => {
    const { db } = setup()
    for (let i = 0; i < MAX_LOGIN_CHALLENGES_PER_IP; i++) must(login(db, '2001:db8:1:2:aaaa::1'))
    expect(login(db, '2001:db8:1:2:bbbb::9')).toBeNull()
    expect(login(db, '2001:db8:1:3::1')).not.toBeNull()
  })

  it(`at most ${String(MAX_LOGIN_CHALLENGES)} live login challenges in total`, () => {
    const { db } = setup()
    const ip = (i: number) => `10.0.${String(Math.floor(i / 10))}.${String(i % 10)}`
    for (let i = 0; i < MAX_LOGIN_CHALLENGES - 1; i++) must(login(db, ip(i)))
    expect(login(db, '10.9.9.1')).not.toBeNull()
    expect(login(db, '10.9.9.2')).toBeNull()
  })

  it('expired rows are pruned before counting', () => {
    const { db } = setup()
    const ip = (i: number) => `10.0.${String(Math.floor(i / 10))}.${String(i % 10)}`
    for (let i = 0; i < MAX_LOGIN_CHALLENGES; i++) must(login(db, ip(i)))
    expect(login(db, '10.9.9.2')).toBeNull()
    expect(login(db, '10.9.9.2', at(CHALLENGE_TTL_MS))).not.toBeNull()
    expect(rows(db)).toHaveLength(1)
  })

  it('register challenges are capped per user and ignore the login caps', () => {
    const { db, tata, starsi } = setup()
    const ip = (i: number) => `10.0.${String(Math.floor(i / 10))}.${String(i % 10)}`
    for (let i = 0; i < MAX_LOGIN_CHALLENGES; i++) must(login(db, ip(i)))
    for (let i = 0; i < MAX_REGISTER_CHALLENGES_PER_USER; i++) must(register(db, tata))
    expect(register(db, tata)).toBeNull()
    expect(register(db, starsi)).not.toBeNull()
  })
})

describe('ipPrefix', () => {
  it('keeps IPv4 whole and cuts IPv6 to its /64', () => {
    expect(ipPrefix('10.0.0.2')).toBe('10.0.0.2')
    expect(ipPrefix('2001:db8:1:2:aaaa::1')).toBe(ipPrefix('2001:db8:1:2:bbbb::9'))
    expect(ipPrefix('2001:db8:1:3::1')).not.toBe(ipPrefix('2001:db8:1:2::1'))
    expect(ipPrefix('::ffff:10.0.0.2')).toBe('10.0.0.2')
    expect(ipPrefix('2001:db8::1')).toBe(ipPrefix('2001:db8::2'))
    expect(ipPrefix('2001:DB8::1')).toBe(ipPrefix('2001:db8::1'))
    expect(ipPrefix('2001:0db8:0000:0000::1')).toBe(ipPrefix('2001:db8::1'))
  })
})
