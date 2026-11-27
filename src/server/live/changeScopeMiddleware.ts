import { createMiddleware } from '@tanstack/react-start'
import { inChangeScope } from '~/server/audit'

/**
 * Each server request runs in its own change scope (#304, audit README "Changes"), so two
 * requests whose runs fall in one tick never share a change, and the live hub skips each tab only
 * for its own. First in `requestMiddleware` (src/start.ts), so every later step runs inside it.
 */
export const changeScopeMiddleware = createMiddleware().server(({ next }) =>
  inChangeScope(() => next()),
)
