// Viewer frames (dev and PR previews only, spec "Multi-user viewer"): each frame of the
// multi-user viewer carries its own session token instead of the shared session cookie.
// Shared by the server (src/server/auth/frame.ts) and the client.

/** Header a frame's server function calls carry: its session token, or NO_TOKEN. */
export const FRAME_HEADER = 'x-tm-frame'

/** Query parameter a frame's document loads carry, same values as FRAME_HEADER. */
export const FRAME_QUERY = 'tmFrame'

/** "A frame with no token". Never an empty value: proxies may drop empty headers. */
export const NO_TOKEN = '-'
