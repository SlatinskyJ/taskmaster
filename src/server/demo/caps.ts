import { ipBucket } from '~/server/auth/clientIp'
import { isDemo } from '~/server/env/demo'

// The public demo's per-IP cap on live streams (docs/superpowers/specs/2026-11-27-demo-
// environment-design.md): one visitor must not hold every stream the hub allows. Only on the
// demo; production keeps the hub's own limits. The login cap lives with the other login limits
// (src/server/auth/rateLimit.ts). In memory: a restart closes every stream anyway.

/** Open live streams one IP may hold on the demo. */
export const DEMO_STREAMS_PER_IP = 12

export interface Gauge {
  /** Takes a place for `key`; false when it already holds `limit`. */
  open(key: string): boolean
  /** Gives one place back; never below 0. */
  close(key: string): void
  /** Keys holding a place (a key at 0 is dropped, so this stays small). */
  size(): number
}

export function createGauge(limit: number): Gauge {
  const open = new Map<string, number>()
  return {
    open(key) {
      const n = open.get(key) ?? 0
      if (n >= limit) return false
      open.set(key, n + 1)
      return true
    },
    close(key) {
      const n = open.get(key) ?? 0
      // A key at 0 leaves the map, so it does not grow with every visitor.
      if (n <= 1) open.delete(key)
      else open.set(key, n - 1)
    },
    size: () => open.size,
  }
}

/** The server's one gauge, used only by the stream route; tests build their own. */
export const liveGauge = createGauge(DEMO_STREAMS_PER_IP)

export interface StreamSlot {
  open(): boolean
  close(): void
}

/** The stream's place in `gauge` under the visitor's IP bucket (an IPv6 /64) on the demo; elsewhere none. */
export function demoStreamSlot(
  env: NodeJS.ProcessEnv,
  ip: string,
  gauge: Gauge = liveGauge,
): StreamSlot | undefined {
  if (!isDemo(env)) return undefined
  const key = ipBucket(ip)
  return {
    open: () => gauge.open(key),
    close: () => {
      gauge.close(key)
    },
  }
}
