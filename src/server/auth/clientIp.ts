/**
 * Picks the client IP: the last `X-Forwarded-For` entry when the proxy is trusted (the caller
 * passes the header only then), else the socket address. Kept free of framework imports for tests.
 */
export function pickClientIp(
  forwardedFor: string | undefined,
  socketIp: string | undefined,
): string {
  const last = forwardedFor?.split(',').at(-1)?.trim()
  return last !== undefined && last !== '' ? last : (socketIp ?? 'unknown')
}
