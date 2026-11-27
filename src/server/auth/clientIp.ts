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

const HEXTET = /^[0-9a-f]{1,4}$/i

/**
 * What the public demo's per-IP caps count (src/server/demo/caps.ts, ./rateLimit.ts): an IPv6
 * visitor by their /64, since one network hands a device many addresses inside it; IPv4 (also
 * IPv4-mapped IPv6) and anything that does not parse as is.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped?.[1] !== undefined) return mapped[1]
  const addr = ip.split('%')[0] ?? ip
  const halves = addr.split('::')
  if (halves.length > 2) return ip
  const side = (s: string | undefined) => (s ? s.split(':') : [])
  const left = side(halves[0])
  const right = side(halves[1])
  const fill = 8 - left.length - right.length
  if (halves.length === 1 ? fill !== 0 : fill < 1) return ip
  const full = [...left, ...Array<string>(fill).fill('0'), ...right]
  if (!full.every((h) => HEXTET.test(h))) return ip
  return `${full
    .slice(0, 4)
    .map((h) => parseInt(h, 16).toString(16))
    .join(':')}::/64`
}
