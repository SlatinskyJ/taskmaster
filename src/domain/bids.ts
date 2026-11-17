import type { PersonId } from './parties'

// The open bids on one negotiation (spec §5.1, §5.2 path 2). Used by one-time task bidding and,
// later, by template score changes, which run the same way.
//
// Only the *open* state is kept here: each bidder's current bid. The history (every bid ever
// made) is not dropped by the domain: every bid is its own append-only record and audit entry,
// written by the caller (spec §5.2, §5.10). The giver side doesn't bid: it counters by changing
// its offer to everyone (Jakub 2026-11-17).

/** A bidder's current bid. At most one per bidder; bidding again replaces it. */
export interface OpenBid {
  by: PersonId
  score: number
}

export interface BidBook {
  bids: readonly OpenBid[]
}

export const EMPTY_BOOK: BidBook = { bids: [] }

/** Places or replaces `by`'s open bid. */
export function placeBid(book: BidBook, by: PersonId, score: number): BidBook {
  return { bids: [...book.bids.filter((b) => b.by !== by), { by, score }] }
}

export function bidOf(book: BidBook, by: PersonId): OpenBid | undefined {
  return book.bids.find((b) => b.by === by)
}

/** The lowest open bid and everyone who holds it (sorted), or null with no bids. */
export function lowestBid(book: BidBook): { score: number; bidders: PersonId[] } | null {
  if (book.bids.length === 0) return null
  const score = Math.min(...book.bids.map((b) => b.score))
  const bidders = book.bids
    .filter((b) => b.score === score)
    .map((b) => b.by)
    .sort((a, b) => a - b)
  return { score, bidders }
}

/** People changed: drops bids whose bidder may no longer bid. Same object when nothing changed. */
export function pruneBook(book: BidBook, mayBid: (id: PersonId) => boolean): BidBook {
  const bids = book.bids.filter((b) => mayBid(b.by))
  return bids.length === book.bids.length ? book : { bids }
}
