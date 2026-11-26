import { FRAME_QUERY, NO_TOKEN } from '~/lib/frame'
import { devPagesAllowed } from '~/server/env/devPages'

// Is this request from a viewer frame, and with which session token? Framework-free: ./http
// passes in what the request says. Frames exist only where dev pages do (dev, PR previews);
// everywhere else every frame signal is ignored and the cookie is the only way in.

export type FrameRequest = { inFrame: false } | { inFrame: true; token: string | undefined }

export interface FrameSignals {
  /** The `x-tm-frame` header (server function calls). */
  header: string | undefined
  /** The `tmFrame` query parameter (document loads). */
  query: string | undefined
  /** `Sec-Fetch-Dest`: `iframe` marks a frame's document load even without the query. */
  fetchDest: string | undefined
}

function tokenOf(value: string): string | undefined {
  return value === '' || value === NO_TOKEN ? undefined : value
}

export function readFrame(env: NodeJS.ProcessEnv, req: FrameSignals): FrameRequest {
  if (!devPagesAllowed(env)) return { inFrame: false }
  if (req.header !== undefined) return { inFrame: true, token: tokenOf(req.header) }
  if (req.query !== undefined) return { inFrame: true, token: tokenOf(req.query) }
  if (req.fetchDest === 'iframe') return { inFrame: true, token: undefined }
  return { inFrame: false }
}

/**
 * A frame's page load that the server redirects (e.g. `/` → `/sprava`) must keep `tmFrame`, or
 * the frame arrives logged out. The new Location (a path, as the router writes same-origin
 * redirects), or null to leave it as it is: outside a frame, in production, for header-carrying
 * requests (server function calls), and for any Location that leaves the site.
 */
export function frameRedirectLocation(
  env: NodeJS.ProcessEnv,
  req: FrameSignals,
  requestUrl: string,
  location: string,
): string | null {
  if (!readFrame(env, req).inFrame || req.header !== undefined || req.query === undefined) {
    return null
  }
  let url: URL
  try {
    url = new URL(location, requestUrl)
    if (url.origin !== new URL(requestUrl).origin) return null
  } catch {
    return null
  }
  // A path starting `//` is read by the browser as another host.
  if (url.pathname.startsWith('//')) return null
  url.searchParams.set(FRAME_QUERY, req.query)
  return url.pathname + url.search + url.hash
}
