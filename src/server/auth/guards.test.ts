import { isRedirect } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '~/domain/parties'
import { ROLES } from '~/domain/parties'
import { safeRedirect } from '~/lib/redirect'
import { authorize, landingPath } from './authorize'
import type { CurrentUser } from './sessions'

const state = vi.hoisted(() => ({ user: null as CurrentUser | null, status: [] as number[] }))
vi.mock('./http', () => ({ currentUser: () => state.user }))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseStatus: (code: number) => state.status.push(code),
}))

const { guardUser, requireRole, requireUser } = await import('./guards')

const person = (role: Role): CurrentUser => ({ id: 1, username: role, displayName: role, role })

/** Runs a guard middleware's server step like Start does, returning the context it passes on. */
function run(mw: { options: { server?: unknown } }): unknown {
  const server = mw.options.server as (opts: {
    next: (o: { context: unknown }) => unknown
  }) => unknown
  return server({ next: (o) => o.context })
}

function outcome(fn: () => unknown): 'ok' | 'login' | 'forbidden' {
  try {
    fn()
    return 'ok'
  } catch (e) {
    if (isRedirect(e)) return 'login'
    if (e instanceof Error && e.message === 'forbidden') return 'forbidden'
    throw e
  }
}

beforeEach(() => {
  state.user = null
  state.status = []
})

describe('authorize (spec §3)', () => {
  it('nobody signed in is unauthenticated, whatever the roles', () => {
    expect(authorize(null)).toEqual({ ok: false, error: 'unauthenticated' })
    expect(authorize(null, ['admin'])).toEqual({ ok: false, error: 'unauthenticated' })
  })

  it.each(ROLES)('%s passes only guards that list its role', (role) => {
    const user = person(role)
    expect(authorize(user)).toEqual({ ok: true, value: user })
    for (const other of ROLES) {
      expect(authorize(user, [other]).ok).toBe(other === role)
    }
    expect(authorize(user, ROLES).ok).toBe(true)
  })

  it('admin lands on Správa, takers and givers on Domů (UI doc §6)', () => {
    expect(landingPath('admin')).toBe('/sprava')
    expect(landingPath('giver')).toBe('/')
    expect(landingPath('taker')).toBe('/')
  })
})

describe('server function guards', () => {
  it('requireUser: nobody → redirect to login with 401; anyone signed in → context.user', () => {
    expect(outcome(() => run(requireUser))).toBe('login')
    expect(state.status).toEqual([401])
    for (const role of ROLES) {
      state.user = person(role)
      expect(run(requireUser)).toEqual({ user: state.user })
    }
  })

  // Every role is refused on the others' guards, with 403.
  it.each(ROLES)('requireRole(%s) lets only that role through', (allowed) => {
    const guard = requireRole(allowed)
    for (const role of ROLES) {
      state.user = person(role)
      state.status = []
      expect(outcome(() => run(guard))).toBe(role === allowed ? 'ok' : 'forbidden')
      expect(state.status).toEqual(role === allowed ? [] : [403])
    }
    state.user = null
    expect(outcome(() => run(guard))).toBe('login')
  })

  it('requireRole with several roles lets each of them through', () => {
    const guard = requireRole('giver', 'taker')
    for (const role of ROLES) {
      state.user = person(role)
      expect(outcome(() => run(guard))).toBe(role === 'admin' ? 'forbidden' : 'ok')
    }
  })

  it('guardUser returns the user it checked', () => {
    state.user = person('giver')
    expect(guardUser(['giver'])).toBe(state.user)
  })
})

describe('login redirect target', () => {
  it('only paths on this site', () => {
    expect(safeRedirect('/sprava')).toBe('/sprava')
    expect(safeRedirect('/?a=1')).toBe('/?a=1')
    expect(safeRedirect('//evil.example')).toBeUndefined()
    expect(safeRedirect('/\\evil.example')).toBeUndefined()
    expect(safeRedirect('https://evil.example')).toBeUndefined()
    expect(safeRedirect(42)).toBeUndefined()
    expect(safeRedirect(undefined)).toBeUndefined()
  })
})
