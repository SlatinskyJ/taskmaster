import type { Me } from '~/components/tasks/taskView'
import { cs } from '~/lib/strings'
import type { TemplateActionResult, TemplateView } from '~/server/templates/functions'

// What a template's price page offers and sends (#138, spec §5.1; runs like bidding §5.2).
// Framework-free and unit-tested: components only render what these return. The server checks
// every call again; a screen sends back exactly the number it showed, so a stale one is refused.

/** One call to a template score change server function. */
export interface PriceCall {
  action: 'bid' | 'counter' | 'acceptBid' | 'acceptOffer'
  data: { templateId: number; score: number }
}

export type PriceButton = PriceCall & { key: string; label: string; hint: string }

export type PriceSend = PriceCall & { label: string; hint: string; disabled: boolean }

/** A change can be made only on an agreed template, by a brother or a parent. */
const canChange = (t: TemplateView, me: Me) => t.status === 'active' && me.role !== 'admin'

/** His own open bid, never another brother's. */
export function myTemplateBid(t: TemplateView, me: Me): number | null {
  return t.change?.bids.find((b) => b.takerId === me.id)?.score ?? null
}

/** Who bid the lowest, oldest first. */
function lowestBidders(t: TemplateView): string[] {
  const lowest = t.change?.lowest
  return (t.change?.bids ?? []).filter((b) => b.score === lowest).map((b) => b.name)
}

const lowestNames = (t: TemplateView) => lowestBidders(t).join(', ')

/** The yes buttons: a brother accepts the parents' offer, a parent the lowest bid. */
export function priceButtons(t: TemplateView, me: Me): PriceButton[] {
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
 * The send button under the stepper. A brother bids; a parent makes a new offer, or, at exactly
 * the lowest bid, accepts it (Jakub 2026-11-18). Disabled where the server says `same_score`.
 */
export function priceSend(t: TemplateView, me: Me, value: number): PriceSend | null {
  if (!canChange(t, me)) return null
  const data = { templateId: t.id, score: value }
  const offer = t.change?.offer?.score ?? null
  if (me.role === 'taker') {
    return {
      action: 'bid',
      data,
      label: cs.bids.send,
      hint: cs.bids.bidHint,
      disabled: value === t.score || value === offer || value === myTemplateBid(t, me),
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
  return myTemplateBid(t, me) ?? t.change?.offer?.score ?? t.score
}

/**
 * The short line of a waiting change: what this person answers. A brother reads the parents'
 * offer, a parent the lowest bid; each falls back to the other side. Null with no change.
 */
export function priceMeta(t: TemplateView, me: Me): string | null {
  const change = t.change
  if (!change) return null
  const offer =
    change.offer && `${change.offer.byName} ${cs.bids.offers} ${String(change.offer.score)}`
  const who = lowestBidders(t)
  const verb = who.length === 1 ? cs.bids.wants : cs.bids.wantMany
  const bids = change.lowest === null ? null : `${who.join(', ')} ${verb} ${String(change.lowest)}`
  return me.role === 'giver' ? (bids ?? offer) : (offer ?? bids)
}

/**
 * The toast after a call succeeded. Agreed only when the number sent is now the score: a bid or a
 * plain offer never comes back as the score (the server refuses `same_score`), and a change
 * someone else agreed meanwhile is not this person's agreement.
 */
export function priceToast(call: PriceCall, result: Extract<TemplateActionResult, { ok: true }>) {
  return result.score === call.data.score ? cs.bids.toast.agreed : cs.bids.toast.sent
}
