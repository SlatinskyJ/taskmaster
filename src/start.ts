import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { frameHeader } from '~/lib/frame'
import { TAB_HEADER, tabId } from '~/lib/tab'
import { frameRedirectMiddleware } from '~/server/auth/frameRedirect'
import { changeScopeMiddleware } from '~/server/live/changeScopeMiddleware'

// The app's Start instance. First, each request gets its own audit change scope
// (src/server/live/changeScopeMiddleware.ts). A custom src/start.ts replaces Start's default CSRF
// check, so it is registered here again, as the default does it: Origin / Sec-Fetch-Site on
// server function calls (src/server/auth/README.md "CSRF"; e2e/frames.spec.ts checks it). After
// it, a viewer frame's page redirects keep the frame's `tmFrame` query
// (src/server/auth/frameRedirect.ts).

/**
 * In a viewer frame (dev and previews), every server function call carries the frame's own
 * session token (src/lib/frame.ts). Outside a frame it adds nothing; the server ignores the
 * header in production anyway.
 */
const frameMiddleware = createMiddleware({ type: 'function' }).client(({ next }) =>
  next({ headers: frameHeader(typeof window === 'undefined' ? undefined : window) }),
)

/**
 * Every server function call from a browser tab carries the tab's id (src/lib/tab.ts), so the
 * live hub skips that tab when it sends the change back (#299). The server render sends none.
 */
const tabMiddleware = createMiddleware({ type: 'function' }).client(({ next }) =>
  next({ headers: typeof window === 'undefined' ? {} : { [TAB_HEADER]: tabId() } }),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [
    // First: every request's audit writes form its own change (#304).
    changeScopeMiddleware,
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }),
    frameRedirectMiddleware,
  ],
  functionMiddleware: [frameMiddleware, tabMiddleware],
}))
