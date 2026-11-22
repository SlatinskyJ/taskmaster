// Shared by the task and template negotiation threads. Its own module so `templates.ts` and
// `tasks.ts` (whose instances point to a template) don't import each other.

/** Which side put a number in the thread: the giver side offers, a taker bids (spec §5.2). */
export const THREAD_SIDES = ['giver', 'taker'] as const
/** How a thread row closed: the same side put a new number, the task was agreed at it, or at something else. */
export const THREAD_CLOSINGS = ['replaced', 'accepted', 'closed'] as const
