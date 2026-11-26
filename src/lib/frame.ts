// Viewer frames (dev and PR previews only, spec "Multi-user viewer"): each frame of the
// multi-user viewer carries its own session token instead of the shared session cookie.
// Shared by the server (src/server/auth/frame.ts) and the client: the client keeps the token
// in the frame's `window.name` and sends it with every server function call (src/start.ts).

/** Header a frame's server function calls carry: its session token, or NO_TOKEN. */
export const FRAME_HEADER = 'x-tm-frame'

/** Query parameter a frame's document loads carry, same values as FRAME_HEADER. */
export const FRAME_QUERY = 'tmFrame'

/** "A frame with no token". Never an empty value: proxies may drop empty headers. */
export const NO_TOKEN = '-'

/** The viewer names each frame `tm-frame:<token>`, or `tm-frame:` while nobody is signed in. */
export const FRAME_NAME_PREFIX = 'tm-frame:'

interface Named {
  name: string
}

/** The frame's token from its window name: undefined for none, null outside a frame. */
function frameToken(win: Named | undefined): string | undefined | null {
  if (!win?.name.startsWith(FRAME_NAME_PREFIX)) return null
  const token = win.name.slice(FRAME_NAME_PREFIX.length)
  return token === '' ? undefined : token
}

/** Headers for a server function call: the frame's token in a frame, nothing otherwise. */
export function frameHeader(win: Named | undefined): Record<string, string> {
  const token = frameToken(win)
  return token === null ? {} : { [FRAME_HEADER]: token ?? NO_TOKEN }
}

/**
 * A frame's document was loaded without its token (e.g. the service worker reloads it after a
 * redeploy), so the server saw nobody: the same URL with `tmFrame=<token>`, or null when the
 * URL is already right or this is not a frame with a token.
 */
export function frameReentryUrl(win: Named & { location: { href: string } }): string | null {
  const token = frameToken(win)
  if (token === null || token === undefined) return null
  const url = new URL(win.location.href)
  if (url.searchParams.get(FRAME_QUERY) === token) return null
  url.searchParams.set(FRAME_QUERY, token)
  return url.toString()
}

/** After a login or logout in a frame: remember the new token (or none) in its name. */
export function keepFrameToken(win: Named | undefined, token: string | undefined): void {
  if (!win || frameToken(win) === null) return
  win.name = FRAME_NAME_PREFIX + (token ?? '')
}
