import type { PersonId } from './parties'

// The open bids on one negotiation (spec §5.1, §5.2 path 2). Used by one-time task bidding and,
// later, by template score changes, which run the same way.
//
// Only the *open* state is kept here: each bidder's current bid and each giver counter. The
// history (every bid and counter ever made) is not dropped by the domain: every bid and counter
// is its own append-only record and audit entry, written by the caller (spec §5.2, §5.10).

/** A bidder's current bid. At most one per bidder; bidding again replaces it. */
export interface OpenBid {
  by: PersonId
  score: number
}

/** The giver side's current counter-offer to one taker. At most one per taker. */
export interface Counter {
  by: PersonId
  to: PersonId
  score: number
}

export interface BidBook {
  bids: readonly OpenBid[]
  counters: readonly Counter[]
}

export const EMPTY_BOOK: BidBook = { bids: [], counters: [] }

/** Places or replaces `by`'s open bid. */
export function placeBid(book: BidBook, by: PersonId, score: number): BidBook {
  return { ...book, bids: [...book.bids.filter((b) => b.by !== by), { by, score }] }
}

export function bidOf(book: BidBook, by: PersonId): OpenBid | undefined {
  return book.bids.find((b) => b.by === by)
}

/** Places or replaces the giver side's counter to `to`. */
export function placeCounter(book: BidBook, counter: Counter): BidBook {
  return { ...book, counters: [...book.counters.filter((c) => c.to !== counter.to), counter] }
}

export function counterTo(book: BidBook, to: PersonId): Counter | undefined {
  return book.counters.find((c) => c.to === to)
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

/**
 * People changed: drops bids whose bidder may no longer bid, and counters whose giver may no
 * longer counter or whose taker may no longer bid. Returns the same object when nothing changed.
 */
export function pruneBook(
  book: BidBook,
  mayBid: (id: PersonId) => boolean,
  mayCounter: (id: PersonId) => boolean,
): BidBook {
  const bids = book.bids.filter((b) => mayBid(b.by))
  const counters = book.counters.filter((c) => mayCounter(c.by) && mayBid(c.to))
  if (bids.length === book.bids.length && counters.length === book.counters.length) return book
  return { bids, counters }
}
