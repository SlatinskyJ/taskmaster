import type { AgreementError, OneTimeAgreement, TemplateAgreement } from './agreement'
import { liveBook } from './agreement'
import {
  acceptLowestBid,
  acceptOneTimeOffer,
  counterOneTimeOffer,
  placeOneTimeBid,
  turnDownOneTimeBids,
  withdrawOneTimeBid,
} from './bidding'
import type { OpenBid } from './bids'
import { lowestBid } from './bids'
import type { Person, PersonId } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Bidding on a proposed template's first score (#209, spec §5.1, Jakub 2026-11-24): "the same
// way as on a one-time task (5.2 path 2, including the same-number rule, a taker's no and a
// giver's turn-down), with no reservation". So the rules are not restated here: the template is
// handed to `bidding.ts` as a one-time Návrh, and whatever that agrees (reserved to one bidder,
// or open after a tie) comes back as an agreed template at that score. Nobody is reserved
// anything; instances never get bidding. Path 1 (a party approves the offer) stays
// `approveTemplate` in `agreement.ts`. Score changes of an agreed template are `scoreChange.ts`.

type Proposed = Extract<TemplateAgreement, { status: 'proposed' }>
type Outcome = Result<TemplateAgreement, AgreementError>

const asTask = (t: Proposed): OneTimeAgreement => ({
  status: 'proposed',
  offer: t.proposal,
  book: t.book,
  lastBids: t.lastBids,
})

/** A one-time result as a template: agreed at its score, or still proposed. */
function back(result: Result<OneTimeAgreement, AgreementError>): Outcome {
  if (!result.ok) return result
  const r = result.value
  if (r.status === 'proposed') {
    return ok({ status: 'proposed', proposal: r.offer, book: r.book, lastBids: r.lastBids })
  }
  if (r.status === 'open' || r.status === 'reserved') {
    return ok({ status: 'agreed', score: r.score, change: null })
  }
  // Unreachable: a Návrh never turns into a reopened round.
  return fail('not_proposed')
}

function onProposed(
  t: TemplateAgreement,
  run: (task: OneTimeAgreement, t: Proposed) => Result<OneTimeAgreement, AgreementError>,
): Outcome {
  if (t.status !== 'proposed') return fail('not_proposed')
  return back(run(asTask(t), t))
}

/** The takers who hold a live bid at `score` (a tie agrees too, so the giver need not name them). */
const biddersAt = (t: Proposed, people: readonly Person[], score: number): PersonId[] =>
  liveBook(t.book, people)
    .bids.filter((b) => b.score === score)
    .map((b) => b.by)

/** A taker bids (or re-bids) a first score: never the offer, nor his last bid since a counter. */
export function placeProposedTemplateBid(
  t: TemplateAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Outcome {
  return onProposed(t, (task) => placeOneTimeBid(task, people, takerId, score))
}

/** A taker's Nechci: only his own open bid closes. */
export function withdrawProposedTemplateBid(
  t: TemplateAgreement,
  people: readonly Person[],
  takerId: PersonId,
): Outcome {
  return onProposed(t, (task) => withdrawOneTimeBid(task, people, takerId))
}

/**
 * A giver turns the bidding down: every open bid closes and he offers the current score again.
 * `seen` are the bids he saw; if they changed meanwhile, `offer_changed`.
 */
export function turnDownProposedTemplateBids(
  t: TemplateAgreement,
  people: readonly Person[],
  giverId: PersonId,
  seen: readonly OpenBid[],
): Outcome {
  return onProposed(t, (task) => turnDownOneTimeBids(task, people, giverId, seen))
}

/** A giver counters with a new offer; at exactly an open bid it agrees at that score. */
export function counterProposedTemplate(
  t: TemplateAgreement,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Outcome {
  return onProposed(t, (task, p) =>
    counterOneTimeOffer(task, people, giverId, score, biddersAt(p, people, score)),
  )
}

/** A taker who bid says yes to the current offer (`score` = the offer he saw): agreed at it. */
export function acceptProposedTemplateOffer(
  t: TemplateAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Outcome {
  return onProposed(t, (task) => acceptOneTimeOffer(task, people, takerId, score))
}

/** A giver accepts the lowest bid (`score` = the lowest he saw): agreed at it, a tie too. */
export function acceptLowestProposedTemplateBid(
  t: TemplateAgreement,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Outcome {
  return onProposed(t, (task, p) => {
    const lowest = lowestBid(liveBook(p.book, people))
    return acceptLowestBid(task, people, giverId, score, lowest?.bidders ?? [])
  })
}
