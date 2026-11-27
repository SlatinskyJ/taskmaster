import { DEMO_LOGINS, type DemoLogin } from '~/lib/demoAccounts'
import { FRAME_QUERY, NO_TOKEN } from '~/lib/frame'

// The multi-user viewer's layout (/dev/multi, dev and PR previews only): which devices are on
// the desk, their sizes, the address and session of each, and how that is remembered in the
// browser. Framework-free: the route renders it, the tests pin it.

/** Frame sizes in CSS pixels; the tablet is drawn smaller so it fits next to the phones. */
export const SIZES = {
  phone: { w: 390, h: 844, scale: 1 },
  small: { w: 360, h: 740, scale: 1 },
  tablet: { w: 820, h: 1180, scale: 0.7 },
} as const
export type SizeKey = keyof typeof SIZES

export interface Device {
  id: string
  user: DemoLogin
  size: SizeKey
  path: string
  /**
   * undefined: the viewer has not logged this frame in yet (it will). null: someone logged out
   * inside the frame; it shows the login screen and the viewer never logs it in again, like a
   * phone. A string: the frame's session.
   */
  token: string | null | undefined
}

const phoneAt = (id: string, user: DemoLogin): Device => ({
  id,
  user,
  size: 'phone',
  path: '/',
  token: undefined,
})

export const DEFAULT_LAYOUT: readonly Device[] = [
  phoneAt('d1', 'tata'),
  phoneAt('d2', 'starsi'),
  phoneAt('d3', 'mladsi'),
]

const defaultLayout = (): Device[] => DEFAULT_LAYOUT.map((d) => ({ ...d }))

const isLogin = (v: unknown): v is DemoLogin => DEMO_LOGINS.some((l) => l === v)
const isSize = (v: unknown): v is SizeKey => typeof v === 'string' && Object.hasOwn(SIZES, v)

function parseDevice(entry: unknown): Device | null {
  if (typeof entry !== 'object' || entry === null) return null
  const { id, user, size, path, token } = entry as Record<string, unknown>
  if (typeof id !== 'string' || !isLogin(user) || !isSize(size)) return null
  return {
    id,
    user,
    size,
    path: (typeof path === 'string' ? safePath(path) : null) ?? '/',
    token: token === null ? null : typeof token === 'string' && token !== '' ? token : undefined,
  }
}

/** The stored layout, or the default when it is missing, broken or leaves no device. */
export function parseLayout(raw: string | null): Device[] {
  if (raw === null) return defaultLayout()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return defaultLayout()
  }
  if (!Array.isArray(data)) return defaultLayout()
  const devices = data.map(parseDevice).filter((d): d is Device => d !== null)
  return devices.length === 0 ? defaultLayout() : devices
}

export function serializeLayout(devices: readonly Device[]): string {
  return JSON.stringify(devices)
}

const BASE = 'https://x'

/** A same-origin path (pathname + search + hash, without tmFrame), or null for anything else. */
export function safePath(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return '/'
  let url: URL
  try {
    // Resolved against a made-up origin: a bare `ukoly` becomes /ukoly, while `//evil`, `/\evil`,
    // another origin or `javascript:` end up elsewhere and are refused.
    url = new URL(trimmed, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  url.searchParams.delete(FRAME_QUERY)
  return url.pathname + url.search + url.hash
}

/** The frame's address: its path with `tmFrame=<token or ->` set. */
export function frameSrc(device: Device): string {
  const url = new URL(safePath(device.path) ?? '/', BASE)
  url.searchParams.set(FRAME_QUERY, device.token ?? NO_TOKEN)
  return url.pathname + url.search + url.hash
}

export function needsLogin(device: Device): boolean {
  return device.token === undefined
}

/** `d<n>`, one past the highest `d<n>` in use. */
export function newDeviceId(devices: readonly Device[]): string {
  const highest = Math.max(0, ...devices.map((d) => Number(/^d(\d+)$/.exec(d.id)?.[1] ?? 0)))
  return `d${String(highest + 1)}`
}
