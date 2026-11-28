import { clientCache } from '~/lib/clientCache'
import { DEMO_LOCKED } from '~/lib/demoAccounts'
import { cs } from '~/lib/strings'
import { getIsDemoFn } from '~/server/env/functions'

// Whether the screens run on the public demo (#328), and what that changes on them.

/**
 * The server's yes/no, kept for the page's life in the browser (the env never changes while a
 * server runs; a reload asks again). A failed call counts as "not the demo" for that one
 * navigation and is not kept: a page must not break over the marker, the server lock still holds.
 */
export function makeIsDemoLoader(
  fetch: () => Promise<boolean>,
  options?: Parameters<typeof clientCache>[2],
): () => Promise<boolean> {
  const cached = clientCache(fetch, Infinity, options)
  return () => cached().catch(() => false)
}

export const loadIsDemo = makeIsDemoLoader(() => getIsDemoFn())

/** Keeps search engines out of the demo. */
export function demoHeadMeta(demo: boolean): { name: string; content: string }[] {
  return demo ? [{ name: 'robots', content: 'noindex, nofollow' }] : []
}

/** The Czech text for the demo lock's refusal, or null for any other failure. */
export function demoLockedMessage(error: unknown): string | null {
  return error instanceof Error && error.message === DEMO_LOCKED ? cs.demo.lockedError : null
}
