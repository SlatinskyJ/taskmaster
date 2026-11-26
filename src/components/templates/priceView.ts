import type { Me } from '~/components/tasks/taskView'
import { cs } from '~/lib/strings'
import type { ItemStateKey } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import type {
  TemplateActionResult,
  TemplateChangeView,
  TemplateView,
} from '~/server/templates/functions'

// What a template's price page offers and sends (#138, spec §5.1; runs like bidding §5.2), and on
// a proposed chore its first-price bidding (#209, switch `choreBidding`: the server leaves
// `bidding` null when it is off, so nothing here shows). Framework-free and unit-tested:
// components only render what these return. The server checks every call again; a screen sends
// back exactly the number it showed, so a stale one is refused.

interface ScoreData {
  templateId: number
  score: number
}

/** One call to a template score server function. */
export type PriceCall =
  | { action: 'bid' | 'counter' | 'acceptBid' | 'acceptOffer' | 'approve'; data: ScoreData }
  | { action: 'withdraw'; data: { templateId: number } }
  | { action: 'turnDown'; data: { templateId: number; bids: { takerId: number; score: number }[] } }

interface Labelled {
  key: string
  label: string
  hint: string
}

export type PriceButton = PriceCall & Labelled

export type PriceSend = { action: 'bid' | 'counter'; data: ScoreData } & {
  label: string
  hint: string
  disabled: boolean
}

/** A change can be made only on an agreed template, by a brother or a parent. */
const canChange = (t: TemplateView, me: Me) => t.status === 'active' && me.role !== 'admin'

/** A proposed chore's first price can be bid on (switch on), by a brother or a parent. */
const canBid = (t: TemplateView, me: Me) =>
  t.status === 'proposed' && t.bidding !== null && me.role !== 'admin'

/** The bids and offer a person answers: an agreed template's change, a proposed one's bidding. */
const bookOf = (t: TemplateView): TemplateChangeView | null => t.change ?? t.bidding

/** His own open bid, never another brother's. */
export function myTemplateBid(t: TemplateView, me: Me): number | null {
  return bookOf(t)?.bids.find((b) => b.takerId === me.id)?.score ?? null
}

/** Who bid `score`, oldest first. */
function biddersAt(t: TemplateView, score: number | null | undefined): string[] {
  return (bookOf(t)?.bids ?? []).filter((b) => b.score === score).map((b) => b.name)
}

const lowestBidders = (t: TemplateView) => biddersAt(t, bookOf(t)?.lowest)
const lowestNames = (t: TemplateView) => lowestBidders(t).join(', ')

/** A proposed chore: a brother agrees to the offer; a parent accepts the lowest bid. */
function firstPriceButtons(t: TemplateView, me: Me): PriceButton[] {
  const bidding = t.bidding
  if (!bidding?.offer) return []
  const data = (score: number) => ({ templateId: t.id, score })
  const { offer, lowest } = bidding
  if (me.role === 'taker') {
    const hint = cs.templatePrice.firstAgreeHint(offer.score)
    return [
      { key: 'approve', action: 'approve', data: data(offer.score), label: cs.tasks.approve, hint },
    ]
  }
  if (lowest === null) return []
  const who = lowestBidders(t)
  const label =
    who.length > 1 ? cs.bids.acceptTie(lowest) : cs.templatePrice.acceptBid(lowest, who.join(', '))
  const hint = cs.templatePrice.firstAgreeHint(lowest)
  return [{ key: 'bid', action: 'acceptBid', data: data(lowest), label, hint }]
}

/** The yes buttons: a brother accepts the parents' offer, a parent the lowest bid. */
export function priceButtons(t: TemplateView, me: Me): PriceButton[] {
  if (canBid(t, me)) return firstPriceButtons(t, me)
  if (!canChange(t, me) || !t.change) return []
  const data = (score: number) => ({ templateId: t.id, score })
  const hint = cs.templatePrice.acceptHint
  const { offer, lowest } = t.change
  if (me.role === 'taker' && offer) {
    const label = cs.templatePrice.acceptOffer(offer.score)
    return [{ key: 'offer', action: 'acceptOffer', data: data(offer.score), label, hint }]
  }
  if (me.role === 'giver' && lowest !== null) {
    const label = cs.templatePrice.acceptBid(lowest, lowestNames(t))
    return [{ key: 'bid', action: 'acceptBid', data: data(lowest), label, hint }]
  }
  return []
}

/**
 * The no button (#208 rules): a brother's Nechci closes his own bid; a parent's turn-down closes
 * every bid he sees (sent back exactly). On a proposed chore (#209) the offer stays; on an agreed
 * chore's price change (#232, only with `refusals`: switch `bidRefusals`) the old price stays.
 */
export function priceRefusal(t: TemplateView, me: Me, refusals = false): PriceButton | null {
  const first = canBid(t, me) ? t.bidding : null
  const book = first ?? (refusals && canChange(t, me) ? t.change : null)
  if (!book) return null
  const { bids } = book
  if (me.role === 'taker') {
    if (myTemplateBid(t, me) === null) return null
    return {
      key: 'withdraw',
      action: 'withdraw',
      data: { templateId: t.id },
      label: cs.bids.withdraw,
      hint: cs.bids.withdrawHint,
    }
  }
  if (bids.length === 0) return null
  // A price change is turned down only to a parents' offer (Jakub 2026-11-26).
  const offer = first ? null : t.change?.offer
  if (!first && !offer) return null
  return {
    key: 'turnDown',
    action: 'turnDown',
    data: { templateId: t.id, bids: bids.map((b) => ({ takerId: b.takerId, score: b.score })) },
    label: cs.bids.turnDown,
    hint: offer
      ? cs.bids.turnDownChangeHint(t.score, offer.score)
      : cs.bids.turnDownHint(first?.offer?.score ?? t.score),
  }
}

/**
 * A brother's last bid since bids last reset or the offer last changed: the same number is
 * refused again. A proposed chore's bidding carries its own (#209), an agreed chore's view its
 * price change's (#232).
 */
const lastBid = (t: TemplateView, me: Me) =>
  (t.bidding?.lastBids ?? t.lastBids).find((b) => b.takerId === me.id)?.score ?? null

/** The send button on a proposed chore: a brother bids, a parent counters or, at a bid, accepts. */
function firstPriceSend(t: TemplateView, me: Me, value: number): PriceSend {
  const data = { templateId: t.id, score: value }
  const offer = t.bidding?.offer?.score ?? t.score
  if (me.role === 'taker') {
    const same = value === lastBid(t, me)
    return {
      action: 'bid',
      data,
      label: cs.bids.send,
      hint: same ? cs.bids.sameAgainHint : cs.bids.bidHint,
      disabled: value === offer || same || value === myTemplateBid(t, me),
    }
  }
  const who = biddersAt(t, value)
  const accepts = who.length > 0
  return {
    action: 'counter',
    data,
    label: accepts ? cs.templatePrice.acceptBid(value, who.join(', ')) : cs.bids.send,
    hint: accepts ? cs.templatePrice.firstAgreeHint(value) : cs.bids.sendHint,
    disabled: value === offer,
  }
}

/**
 * The send button under the stepper. A brother bids; a parent makes a new offer, or, at exactly
 * the lowest bid, accepts it (Jakub 2026-11-18). Disabled where the server says `same_score`.
 */
export function priceSend(t: TemplateView, me: Me, value: number): PriceSend | null {
  if (canBid(t, me)) return firstPriceSend(t, me, value)
  if (!canChange(t, me)) return null
  const data = { templateId: t.id, score: value }
  const offer = t.change?.offer?.score ?? null
  if (me.role === 'taker') {
    const same = value === lastBid(t, me)
    return {
      action: 'bid',
      data,
      label: cs.bids.send,
      hint: same ? cs.bids.sameAgainHint : cs.bids.bidHint,
      disabled: value === t.score || value === offer || same || value === myTemplateBid(t, me),
    }
  }
  const accepts = value === t.change?.lowest
  return {
    action: 'counter',
    data,
    label: accepts ? cs.templatePrice.acceptBid(value, lowestNames(t)) : cs.bids.send,
    hint: accepts ? cs.templatePrice.acceptHint : cs.bids.sendHint,
    disabled: value === t.score || value === offer,
  }
}

/** Where the stepper starts: his own bid, else the open offer, else the score. */
export function stepperStart(t: TemplateView, me: Me): number {
  return myTemplateBid(t, me) ?? bookOf(t)?.offer?.score ?? t.score
}

/**
 * The short line of a waiting change or first-price bidding: what this person answers. A brother
 * reads the parents' offer, a parent the lowest bid; each falls back to the other side. Null with
 * nothing to answer.
 */
export function priceMeta(t: TemplateView, me: Me): string | null {
  const book = bookOf(t)
  if (!book) return null
  const offer = book.offer && `${book.offer.byName} ${cs.bids.offers} ${String(book.offer.score)}`
  const who = lowestBidders(t)
  const verb = who.length === 1 ? cs.bids.wants : cs.bids.wantMany
  const bids = book.lowest === null ? null : `${who.join(', ')} ${verb} ${String(book.lowest)}`
  return me.role === 'giver' ? (bids ?? offer) : (offer ?? bids)
}

/**
 * The toast after a call succeeded. On a proposed chore, agreed only when it turned active (its
 * offer is its score, so a counter comes back at the number sent). On an agreed one, agreed only
 * when the number sent is now the score: a bid or a plain offer never comes back as the score
 * (the server refuses `same_score`), and a change someone else agreed meanwhile is not mine.
 */
export function priceToast(
  call: PriceCall,
  result: Extract<TemplateActionResult, { ok: true }>,
  wasProposed = false,
) {
  if (call.action === 'withdraw') return cs.bids.toast.withdrawn
  if (call.action === 'turnDown') return cs.bids.toast.turnedDown
  // A first price agrees only when the chore came back active at the number sent. A bid never
  // agrees, and a call that landed after the chore went active runs as a score change (§5.1).
  if (wasProposed) {
    const agreed =
      call.action !== 'bid' && result.status === 'active' && result.score === call.data.score
    return agreed ? cs.bids.toast.agreed : cs.bids.toast.sent
  }
  return result.score === call.data.score ? cs.bids.toast.agreed : cs.bids.toast.sent
}

/** A turn-down refused as stale means a bid came in, not that the price moved. */
export function priceError(call: PriceCall): (error: string) => string {
  return (error) =>
    call.action === 'turnDown' && error === 'offer_changed'
      ? cs.bids.turnDownChanged
      : taskErrorMessage(error)
}

/** The chip of a template: proposed (negotiating with bids), negotiating while a change is in flight, else "Platí". */
export function templateChip(t: TemplateView): { state: ItemStateKey; label?: string } {
  if (t.status === 'proposed') {
    return (t.bidding?.bids.length ?? 0) > 0 ? { state: 'negotiating' } : { state: 'proposed' }
  }
  if (t.change) return { state: 'negotiating' }
  return { state: 'confirmed', label: cs.templates.activeChip }
}
