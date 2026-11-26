import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { toIsoUtc } from '~/domain/dates'
import { auditLog, suggestions } from '~/server/db/schema'
import { failAuditOn, family, json, must, T0, T1, T2 } from '~/server/tasks/testing'
import { claimSend, releaseSend } from './sending'
import {
  closeSuggestionIn,
  createSuggestionIn,
  listAllSuggestions,
  listMySuggestions,
} from './store'

// The suggestion store (spec §5.13, #247): rows and their audit entries.
const SENT = {
  issueUrl: 'https://github.com/SlatinskyJ/taskmaster/issues/300',
  issueNumber: 300,
  sentTitle: 'Tmavý režim',
  sentBody: 'Body',
  sentAt: T0.toISOString(),
}

const rows = (f: ReturnType<typeof family>) => f.db.select().from(suggestions).all()
const entries = (f: ReturnType<typeof family>) => f.db.select().from(auditLog).all()
const row = (f: ReturnType<typeof family>, id: number) =>
  f.db.select().from(suggestions).where(eq(suggestions.id, id)).get()

function suggest(f: ReturnType<typeof family>, userId: number, title: string, at = T0): number {
  return must(createSuggestionIn(f.db, userId, { title, description: '' }, at)).id
}

describe('createSuggestionIn', () => {
  it('stores the cleaned text and one suggestion.created entry', () => {
    const f = family()
    const { id } = must(
      createSuggestionIn(
        f.db,
        f.starsi,
        { title: ' Tmavý\nrežim​ ', description: ' Večer\r\nsvítí ' },
        T0,
      ),
    )
    expect(row(f, id)).toMatchObject({
      authorId: f.starsi,
      title: 'Tmavý režim',
      description: 'Večer\nsvítí',
      status: 'new',
      createdAt: toIsoUtc(T0),
      issueUrl: null,
      closedBy: null,
    })
    const [entry, ...rest] = entries(f).filter((e) => e.action.startsWith('suggestion.'))
    expect(rest).toHaveLength(0)
    expect(entry).toMatchObject({
      action: 'suggestion.created',
      entityType: 'suggestion',
      entityId: String(id),
      actorUserId: f.starsi,
      before: null,
      at: toIsoUtc(T0),
    })
    expect(json(entry?.after)).toStrictEqual({ title: 'Tmavý režim', description: 'Večer\nsvítí' })
  })

  it('refuses a bad text and writes no row and no entry', () => {
    const f = family()
    const before = entries(f).length
    expect(createSuggestionIn(f.db, f.tata, { title: ' ​ ', description: '' }, T0)).toEqual({
      ok: false,
      error: 'title_empty',
    })
    expect(
      createSuggestionIn(f.db, f.tata, { title: 'T', description: 'a'.repeat(2001) }, T0),
    ).toEqual({ ok: false, error: 'description_too_long' })
    expect(rows(f)).toHaveLength(0)
    expect(entries(f)).toHaveLength(before)
  })

  it('rolls back the row when the audit entry fails', () => {
    const f = family()
    failAuditOn(f.db, 'suggestion.created')
    expect(() => createSuggestionIn(f.db, f.starsi, { title: 'T', description: '' }, T0)).toThrow()
    expect(rows(f)).toHaveLength(0)
  })
})

describe('listMySuggestions', () => {
  it("holds only the caller's rows, newest first, with no author", () => {
    const f = family()
    const a1 = suggest(f, f.starsi, 'První', T0)
    suggest(f, f.mladsi, 'Cizí', T1)
    const a2 = suggest(f, f.starsi, 'Druhý', T2)
    const mine = listMySuggestions(f.db, f.starsi)
    expect(mine.map((s) => s.id)).toEqual([a2, a1])
    expect(mine[0]).toStrictEqual({
      id: a2,
      title: 'Druhý',
      description: null,
      status: 'new',
      issueUrl: null,
      createdAt: toIsoUtc(T2),
    })
  })
})

describe('listAllSuggestions', () => {
  it('holds every row with its author, newest first, higher id first on the same time', () => {
    const f = family()
    const a = suggest(f, f.starsi, 'A', T0)
    const b = suggest(f, f.tata, 'B', T1)
    const c = suggest(f, f.mladsi, 'C', T1)
    f.db
      .update(suggestions)
      .set({ status: 'sent', ...SENT })
      .where(eq(suggestions.id, a))
      .run()
    const all = listAllSuggestions(f.db)
    expect(all.map((s) => s.id)).toEqual([c, b, a])
    expect(all[2]).toStrictEqual({
      id: a,
      title: 'A',
      description: null,
      status: 'sent',
      issueUrl: SENT.issueUrl,
      createdAt: toIsoUtc(T0),
      author: { id: f.starsi, displayName: 'Starší' },
    })
    expect(all[1]?.author).toStrictEqual({ id: f.tata, displayName: 'Táta' })
  })
})

describe('closeSuggestionIn', () => {
  it.each([
    ['done', 'done', 'suggestion.done'],
    ['dismiss', 'dismissed', 'suggestion.dismissed'],
  ] as const)('the admin moves a new one with %s', (move, status, action) => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    expect(closeSuggestionIn(f.db, f.admin, id, move, T1)).toEqual({ ok: true, value: { id } })
    expect(row(f, id)).toMatchObject({ status, closedBy: f.admin, closedAt: toIsoUtc(T1) })
    const mine = entries(f).filter((e) => e.action === action)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toStrictEqual({
      id: mine[0]?.id,
      at: toIsoUtc(T1),
      actorKind: 'user',
      actorUserId: f.admin,
      action,
      entityType: 'suggestion',
      entityId: String(id),
      before: JSON.stringify({ status: 'new' }),
      after: JSON.stringify({ status }),
      reason: null,
    })
  })

  it('marks a sent one done, but never dismisses it', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    f.db
      .update(suggestions)
      .set({ status: 'sent', ...SENT })
      .where(eq(suggestions.id, id))
      .run()
    expect(closeSuggestionIn(f.db, f.admin, id, 'dismiss', T1)).toEqual({
      ok: false,
      error: 'not_new',
    })
    expect(row(f, id)?.status).toBe('sent')
    expect(closeSuggestionIn(f.db, f.admin, id, 'done', T1)).toEqual({ ok: true, value: { id } })
    expect(row(f, id)).toMatchObject({ status: 'done', issueUrl: SENT.issueUrl })
    const done = entries(f).filter((e) => e.action === 'suggestion.done')
    expect(json(done[0]?.before)).toStrictEqual({ status: 'sent' })
  })

  it('refuses a closed one', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    must(closeSuggestionIn(f.db, f.admin, id, 'dismiss', T1))
    const before = entries(f).length
    expect(closeSuggestionIn(f.db, f.admin, id, 'done', T2)).toEqual({ ok: false, error: 'closed' })
    expect(closeSuggestionIn(f.db, f.admin, id, 'dismiss', T2)).toEqual({
      ok: false,
      error: 'closed',
    })
    expect(entries(f)).toHaveLength(before)
  })

  it('refuses a giver, a taker and an inactive admin, and writes nothing', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    const before = entries(f).length
    for (const actor of [f.tata, f.starsi]) {
      expect(closeSuggestionIn(f.db, actor, id, 'done', T1)).toEqual({
        ok: false,
        error: 'not_admin',
      })
    }
    f.db.$client.exec(`UPDATE users SET active = 0 WHERE id = ${f.admin}`)
    expect(closeSuggestionIn(f.db, f.admin, id, 'done', T1)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    expect(row(f, id)?.status).toBe('new')
    expect(entries(f)).toHaveLength(before)
  })

  it('refuses an unknown id', () => {
    const f = family()
    expect(closeSuggestionIn(f.db, f.admin, 999, 'done', T1)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('refuses while a send of the same id is running', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    expect(claimSend(id)).toBe(true)
    try {
      expect(closeSuggestionIn(f.db, f.admin, id, 'done', T1)).toEqual({
        ok: false,
        error: 'busy',
      })
      expect(row(f, id)?.status).toBe('new')
    } finally {
      releaseSend(id)
    }
    expect(closeSuggestionIn(f.db, f.admin, id, 'done', T1).ok).toBe(true)
  })

  it('answers closed when its update changed no row although the row still allows it', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    f.db.$client.exec(
      `CREATE TRIGGER skip BEFORE UPDATE OF closed_by ON suggestions BEGIN SELECT RAISE(IGNORE); END`,
    )
    const before = entries(f).length
    expect(closeSuggestionIn(f.db, f.admin, id, 'done', T1)).toEqual({ ok: false, error: 'closed' })
    expect(row(f, id)?.status).toBe('new')
    expect(entries(f)).toHaveLength(before)
  })

  it('says why from the row as it is when another write moved it first', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    // Another writer sends it between the read and the update, and this update changes no row.
    f.db.$client.exec(
      `CREATE TRIGGER race BEFORE UPDATE OF closed_by ON suggestions BEGIN
         UPDATE suggestions SET status = 'sent', issue_url = '${SENT.issueUrl}', issue_number = 300,
           sent_title = 'T', sent_body = 'B', sent_at = '${SENT.sentAt}' WHERE id = OLD.id;
         SELECT RAISE(IGNORE);
       END`,
    )
    const before = entries(f).length
    expect(closeSuggestionIn(f.db, f.admin, id, 'dismiss', T1)).toEqual({
      ok: false,
      error: 'not_new',
    })
    expect(row(f, id)?.status).toBe('sent')
    expect(entries(f)).toHaveLength(before)
  })

  it('rolls back the change when the audit entry fails', () => {
    const f = family()
    const id = suggest(f, f.starsi, 'T')
    failAuditOn(f.db, 'suggestion.done')
    expect(() => closeSuggestionIn(f.db, f.admin, id, 'done', T1)).toThrow()
    expect(row(f, id)).toMatchObject({ status: 'new', closedBy: null, closedAt: null })
  })
})
