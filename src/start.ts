import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { frameHeader } from '~/lib/frame'
import { frameRedirectMiddleware } from '~/server/auth/frameRedirect'

// The app's Start instance. A custom src/start.ts replaces Start's default CSRF check, so it is
// registered here again, as the default does it: Origin / Sec-Fetch-Site on server function
// calls (src/server/auth/README.md "CSRF"; e2e/frames.spec.ts checks it). After it, a viewer
// frame's page redirects keep the frame's `tmFrame` query (src/server/auth/frameRedirect.ts).

/**
 * In a viewer frame (dev and previews), every server function call carries the frame's own
 * session token (src/lib/frame.ts). Outside a frame it adds nothing; the server ignores the
 * header in production anyway.
 */
const frameMiddleware = createMiddleware({ type: 'function' }).client(({ next }) =>
  next({ headers: frameHeader(typeof window === 'undefined' ? undefined : window) }),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }),
    frameRedirectMiddleware,
  ],
  functionMiddleware: [frameMiddleware],
}))
