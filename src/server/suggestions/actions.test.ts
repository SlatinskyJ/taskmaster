import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { toIsoUtc } from '~/domain/dates'
import { auditLog, suggestions } from '~/server/db/schema'
import { family, must, T0, T1 } from '~/server/tasks/testing'
import {
  closeSuggestionAction,
  createSuggestionAction,
  getAdminSuggestionsAction,
  listMySuggestionsAction,
  sendSuggestionAction,
} from './actions'
import type { FetchFn } from './github'
import { parseClose, parseNewSuggestion, parseSend } from './parse'

// The suggestion server functions' work (spec §5.13, #247), behind the `suggestions` switch.
const TOKEN = 'github_pat_SECRET123'
const ENV = { SUGGESTIONS_GITHUB_TOKEN: TOKEN }
const URL_OK = 'https://github.com/SlatinskyJ/taskmaster/issues/301'

function setup(switchOn: boolean) {
  const f = family()
  if (switchOn) f.db.run(sql`UPDATE feature_flags SET enabled = 1 WHERE key = 'suggestions'`)
  const calls: unknown[] = []
  const fetchFn = ((url: string) => {
    calls.push(url)
    return Promise.resolve(
      new Response(JSON.stringify({ number: 301, html_url: URL_OK }), { status: 201 }),
    )
  }) as unknown as FetchFn
  const count = () => ({
    rows: f.db.select().from(suggestions).all().length,
    entries: f.db.select().from(auditLog).all().length,
  })
  return { ...f, calls, fetchFn, count }
}

const NEW = { title: 'Tmavý režim', description: '' }
const OFF = { ok: false, error: 'feature_off' }

describe('with the switch off', () => {
  it('every action answers feature_off and writes nothing', async () => {
    const f = setup(false)
    // A row written directly, so close and send have something they could touch.
    const id = f.db
      .insert(suggestions)
      .values({ authorId: f.starsi, title: 'T', createdAt: toIsoUtc(T0), status: 'new' })
      .returning()
      .get().id
    const before = f.count()
    expect(createSuggestionAction(f.db, f.starsi, NEW, T1)).toEqual(OFF)
    expect(listMySuggestionsAction(f.db, f.starsi)).toEqual({ error: 'feature_off' })
    expect(getAdminSuggestionsAction(f.db, ENV)).toEqual({ error: 'feature_off' })
    expect(closeSuggestionAction(f.db, f.admin, { id, move: 'done' }, T1)).toEqual(OFF)
    expect(
      await sendSuggestionAction(f.db, f.admin, { id, title: 'T', body: '' }, ENV, T1, f.fetchFn),
    ).toEqual(OFF)
    expect(f.count()).toEqual(before)
    expect(f.calls).toHaveLength(0)
    expect(f.db.select().from(suggestions).where(eq(suggestions.id, id)).get()?.status).toBe('new')
  })
})

describe('with the switch on', () => {
  it('creates and lists mine', () => {
    const f = setup(true)
    const { id } = must(createSuggestionAction(f.db, f.starsi, NEW, T0))
    expect(listMySuggestionsAction(f.db, f.starsi)).toStrictEqual([
      {
        id,
        title: 'Tmavý režim',
        description: null,
        status: 'new',
        issueUrl: null,
        createdAt: toIsoUtc(T0),
      },
    ])
    expect(listMySuggestionsAction(f.db, f.mladsi)).toEqual([])
  })

  it("gives the admin everyone's with canSend, and never the token", () => {
    const f = setup(true)
    const { id } = must(createSuggestionAction(f.db, f.starsi, NEW, T0))
    const list = getAdminSuggestionsAction(f.db, ENV)
    expect(list).toStrictEqual({
      items: [
        {
          id,
          title: 'Tmavý režim',
          description: null,
          status: 'new',
          issueUrl: null,
          createdAt: toIsoUtc(T0),
          author: { id: f.starsi, displayName: 'Starší' },
        },
      ],
      canSend: true,
    })
    expect(JSON.stringify(list)).not.toContain(TOKEN)
  })

  it('canSend is false without a token', () => {
    const f = setup(true)
    expect(getAdminSuggestionsAction(f.db, {})).toEqual({ items: [], canSend: false })
    expect(getAdminSuggestionsAction(f.db, { SUGGESTIONS_GITHUB_TOKEN: ' ' })).toEqual({
      items: [],
      canSend: false,
    })
  })

  it('closes', () => {
    const f = setup(true)
    const { id } = must(createSuggestionAction(f.db, f.starsi, NEW, T0))
    expect(closeSuggestionAction(f.db, f.admin, { id, move: 'dismiss' }, T1)).toEqual({
      ok: true,
      value: { id },
    })
  })

  it('sends with the token from the environment', async () => {
    const f = setup(true)
    const { id } = must(createSuggestionAction(f.db, f.starsi, NEW, T0))
    expect(
      await sendSuggestionAction(f.db, f.admin, { id, title: 'T', body: '' }, ENV, T1, f.fetchFn),
    ).toEqual({ ok: true, value: { url: URL_OK } })
    expect(f.calls).toHaveLength(1)
  })

  it('answers no_token without one', async () => {
    const f = setup(true)
    const { id } = must(createSuggestionAction(f.db, f.starsi, NEW, T0))
    expect(
      await sendSuggestionAction(f.db, f.admin, { id, title: 'T', body: '' }, {}, T1, f.fetchFn),
    ).toEqual({ ok: false, error: 'no_token' })
    expect(f.calls).toHaveLength(0)
  })
})

describe('parse', () => {
  it('keeps the known keys and drops the rest', () => {
    expect(
      parseNewSuggestion({ title: 'T', description: 'D', authorId: 1, status: 'sent' }),
    ).toStrictEqual({
      title: 'T',
      description: 'D',
    })
    expect(parseClose({ id: 3, move: 'done', closedBy: 1 })).toStrictEqual({ id: 3, move: 'done' })
    expect(parseSend({ id: 3, title: 'T', body: 'B', issueUrl: 'x' })).toStrictEqual({
      id: 3,
      title: 'T',
      body: 'B',
    })
  })

  it('throws on a wrong shape', () => {
    expect(() => parseClose({ id: 3, move: 'send' })).toThrow()
    expect(() => parseClose({ id: 3, move: 'delete' })).toThrow()
    expect(() => parseClose({ id: '3', move: 'done' })).toThrow()
    expect(() => parseClose({ id: 1.5, move: 'done' })).toThrow()
    expect(() => parseNewSuggestion({ title: 'T' })).toThrow()
    expect(() => parseNewSuggestion(null)).toThrow()
    expect(() => parseNewSuggestion('T')).toThrow()
    expect(() => parseSend({ id: 3, title: 'T', body: 7 })).toThrow()
  })

  it('takes a string of 10,000 characters and throws on 10,001', () => {
    const at = (n: number) => 'a'.repeat(n)
    expect(parseNewSuggestion({ title: at(10_000), description: at(10_000) }).title).toHaveLength(
      10_000,
    )
    expect(() => parseNewSuggestion({ title: at(10_001), description: '' })).toThrow()
    expect(() => parseNewSuggestion({ title: 'T', description: at(10_001) })).toThrow()
    expect(parseSend({ id: 1, title: at(10_000), body: at(10_000) }).body).toHaveLength(10_000)
    expect(() => parseSend({ id: 1, title: 'T', body: at(10_001) })).toThrow()
    expect(() => parseSend({ id: 1, title: at(10_001), body: '' })).toThrow()
  })
})
