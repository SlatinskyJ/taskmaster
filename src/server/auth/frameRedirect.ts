import { createMiddleware } from '@tanstack/react-start'
import { frameRedirectLocation, frameSignals } from './frame'

/**
 * A viewer frame's page load (dev and previews) that the server redirects keeps its `tmFrame`
 * query, so the frame arrives at the new address still logged in (./frame
 * `frameRedirectLocation`). Page requests only: server function redirects travel as JSON. The
 * header is rewritten in place, so Start's later redirect handling still sees its redirect.
 */
export const frameRedirectMiddleware = createMiddleware().server(
  async ({ request, handlerType, next }) => {
    const result = await next()
    if (handlerType !== 'router') return result
    const { response } = result
    const location = response.headers.get('Location')
    if (response.status < 300 || response.status > 399 || location === null) return result
    const signals = frameSignals((n) => request.headers.get(n) ?? undefined, new URL(request.url))
    const kept = frameRedirectLocation(process.env, signals, request.url, location)
    if (kept !== null) response.headers.set('Location', kept)
    return result
  },
)
