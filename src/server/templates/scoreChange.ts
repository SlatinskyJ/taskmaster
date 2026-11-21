import { and, eq } from 'drizzle-orm'
import {
  acceptLowestTemplateBid,
  acceptTemplateOffer,
  bidTemplateScore,
  counterTemplateScore,
  isActiveAs,
} from '~/domain'
import type { Person, TemplateAgreement } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { templates } from '~/server/db/schema'
import type { TemplateRow, TemplateThreadRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import type { TemplateError } from './templates'
import { agreementOf } from './templates'
import { addEntry, closeThread, openRows } from './thread'

// Changing the score of an agreed template (spec §5.1: runs like bidding, §5.2; Jakub
// 2026-11-17/18). The rules live in src/domain/scoreChange.ts; each action loads the template,
// asks the domain, and writes the thread rows, the score and the audit entries in one
// transaction. The old score stays until an acceptance; only instances created afterwards get the
// new one (instances read `templates.score` when they are made).
//
// Who may call what (the domain checks it, live against current people):
// - bid: an active taker, a number other than the score, the offer and his own open bid;
// - counter: any active giver; at exactly the lowest live bid it accepts that bid;
// - acceptLowestBid: any active giver, with the lowest bid he saw;
// - acceptOffer: any active taker, with the offer he saw.
//
// Each action has an `…In(tx)` twin for callers that already hold a transaction (the demo seed).

type Action = (
  tx: Tx,
  userId: number,
  templateId: number,
  score: number,
  now: Date,
) => Result<TemplateRow, TemplateError>

interface Ctx {
  tx: Tx
  row: TemplateRow
  agreement: TemplateAgreement
  people: Person[]
}

type ByWhat = 'bid' | 'offer' | 'counter'

function onTemplate(
  tx: Tx,
  templateId: number,
  run: (ctx: Ctx) => Result<TemplateRow, TemplateError>,
): Result<TemplateRow, TemplateError> {
  const row = tx.select().from(templates).where(eq(templates.id, templateId)).get()
  if (!row) return fail('not_found')
  return run({ tx, row, agreement: agreementOf(tx, row), people: listPeople(tx) })
}

const inTransaction =
  (action: Action) =>
  (db: Db, userId: number, templateId: number, score: number, now: Date = new Date()) =>
    db.transaction((tx) => action(tx, userId, templateId, score, now))

/** Open bids of current takers at `score`: the ones an acceptance at that score takes. */
function liveBidsAt(tx: Tx, templateId: number, people: Person[], score: number): number[] {
  return openRows(tx, templateId)
    .filter((r) => r.side === 'taker' && r.score === score && isActiveAs(people, r.userId, 'taker'))
    .map((r) => r.id)
}

/**
 * The change is agreed at `score`: the template gets it, every open row closes (`accepted` for
 * `acceptedIds`), and one `template.score_changed` entry names them all.
 */
function changeScore(
  { tx, row }: Ctx,
  score: number,
  acceptedIds: readonly number[],
  by: ByWhat,
  actor: { kind: 'user'; userId: number },
  now: Date,
  replacedOffer: TemplateThreadRow | null = null,
): TemplateRow {
  const saved = tx
    .update(templates)
    .set({ score, updatedAt: toIsoUtc(now) })
    .where(and(eq(templates.id, row.id), eq(templates.status, 'active')))
    .returning()
    .all()
    .at(0)
  // Unreachable: the domain refused anything but an agreed (active) template in this same
  // synchronous transaction. Throwing rolls back every write of the action.
  if (!saved) throw new Error(`template ${String(row.id)} not active mid-transaction`)
  const { accepted, closed } = closeThread(tx, row.id, acceptedIds, now)
  writeAudit(tx, {
    actor,
    action: 'template.score_changed',
    entityType: 'template',
    entityId: row.id,
    before: replacedOffer
      ? {
          score: row.score,
          replacedOffer: { entryId: replacedOffer.id, score: replacedOffer.score },
        }
      : { score: row.score },
    after: { score, entryIds: accepted, closedIds: closed, by },
    at: now,
  })
  return saved
}

/** A taker bids (or re-bids) a new score. The template's score is not touched. */
export const bidOnTemplateIn: Action = (tx, takerId, templateId, score, now) =>
  onTemplate(tx, templateId, ({ row, agreement, people }) => {
    const result = bidTemplateScore(agreement, people, takerId, score)
    if (!result.ok) return result
    const { entry, replaced } = addEntry(
      tx,
      { templateId, userId: takerId, side: 'taker', score },
      now,
    )
    writeAudit(tx, {
      actor: { kind: 'user', userId: takerId },
      action: 'template.bid_placed',
      entityType: 'template',
      entityId: templateId,
      before: replaced ? { entryId: replaced.id, score: replaced.score } : undefined,
      after: { entryId: entry.id, score },
      at: now,
    })
    return ok(row)
  })

/**
 * A giver counters with a new offer to every taker. At exactly the lowest live bid the domain
 * agrees it: the counter row is written and accepted together with those bids.
 */
export const counterOnTemplateIn: Action = (tx, giverId, templateId, score, now) =>
  onTemplate(tx, templateId, (ctx) => {
    const result = counterTemplateScore(ctx.agreement, ctx.people, giverId, score)
    if (!result.ok) return result
    const actor = { kind: 'user', userId: giverId } as const
    const bids = liveBidsAt(tx, templateId, ctx.people, score)
    const { entry, replaced } = addEntry(
      tx,
      { templateId, userId: giverId, side: 'giver', score },
      now,
    )
    if (result.value.status === 'agreed' && result.value.change === null) {
      return ok(changeScore(ctx, score, [...bids, entry.id], 'counter', actor, now, replaced))
    }
    writeAudit(tx, {
      actor,
      action: 'template.score_countered',
      entityType: 'template',
      entityId: templateId,
      before: replaced ? { entryId: replaced.id, score: replaced.score } : undefined,
      after: { entryId: entry.id, score },
      at: now,
    })
    return ok(ctx.row)
  })

/** A giver accepts the lowest bid (`score` = the lowest he saw); every bid at it is accepted. */
export const acceptLowestBidOnTemplateIn: Action = (tx, giverId, templateId, score, now) =>
  onTemplate(tx, templateId, (ctx) => {
    const result = acceptLowestTemplateBid(ctx.agreement, ctx.people, giverId, score)
    if (!result.ok) return result
    const bids = liveBidsAt(tx, templateId, ctx.people, score)
    return ok(changeScore(ctx, score, bids, 'bid', { kind: 'user', userId: giverId }, now))
  })

/** A taker accepts the giver side's offer (`score` = the offer he saw). */
export const acceptOfferOnTemplateIn: Action = (tx, takerId, templateId, score, now) =>
  onTemplate(tx, templateId, (ctx) => {
    const result = acceptTemplateOffer(ctx.agreement, ctx.people, takerId, score)
    if (!result.ok) return result
    const offer = openRows(tx, templateId).filter((r) => r.side === 'giver')
    return ok(
      changeScore(
        ctx,
        score,
        offer.map((r) => r.id),
        'offer',
        { kind: 'user', userId: takerId },
        now,
      ),
    )
  })

export const bidOnTemplate = inTransaction(bidOnTemplateIn)
export const counterOnTemplate = inTransaction(counterOnTemplateIn)
export const acceptLowestBidOnTemplate = inTransaction(acceptLowestBidOnTemplateIn)
export const acceptOfferOnTemplate = inTransaction(acceptOfferOnTemplateIn)
