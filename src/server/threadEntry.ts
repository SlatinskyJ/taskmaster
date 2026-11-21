/**
 * One row of a negotiation thread (a task's bidding, or a template's score change), as a detail
 * screen shows it. Shared so the two reads don't depend on each other.
 */
export interface ThreadEntry {
  id: number
  side: 'giver' | 'taker'
  by: { id: number; name: string }
  score: number
  /** When it was made (UTC ISO). */
  at: string
  state: 'open' | 'replaced' | 'accepted' | 'closed'
}
