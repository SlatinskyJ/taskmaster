// Passkey relying party (spec §11 Passkeys). Passkeys are on only when WEBAUTHN_RP_ID is set:
// production sets it to its own host, previews leave it unset (Jakub, 2026-11-18). A bad value
// throws at boot, so a typo stops the server instead of failing every registration later.

export interface PasskeyConfig {
  /** The host passkeys are bound to, e.g. `taskmaster.example.cz`. */
  rpId: string
  rpName: 'Taskmaster'
  /** The exact origin browsers report: scheme, host and port, no trailing slash. */
  origin: string
}

export class PasskeyConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasskeyConfigError'
  }
}

/** A lowercase host name: no scheme, port, path or upper case. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

export function passkeyConfig(env: NodeJS.ProcessEnv = process.env): PasskeyConfig | null {
  const rpId = env.WEBAUTHN_RP_ID
  if (!rpId) return null
  if (!HOST.test(rpId)) {
    throw new PasskeyConfigError(
      `WEBAUTHN_RP_ID must be a lowercase host name like taskmaster.example.cz, got "${rpId}"`,
    )
  }
  // An empty WEBAUTHN_ORIGIN counts as unset, like an empty WEBAUTHN_RP_ID.
  const given = env.WEBAUTHN_ORIGIN
  const raw = given !== undefined && given !== '' ? given : `https://${rpId}`
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PasskeyConfigError(`WEBAUTHN_ORIGIN is not a URL: "${raw}"`)
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || raw.includes('#')) {
    throw new PasskeyConfigError(`WEBAUTHN_ORIGIN must have no path, query or fragment: "${raw}"`)
  }
  if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) {
    throw new PasskeyConfigError(`WEBAUTHN_ORIGIN "${raw}" is not on ${rpId}`)
  }
  const httpOk = rpId === 'localhost' && url.protocol === 'http:'
  if (url.protocol !== 'https:' && !httpOk) {
    throw new PasskeyConfigError(`WEBAUTHN_ORIGIN must use https: "${raw}"`)
  }
  return { rpId, rpName: 'Taskmaster', origin: url.origin }
}

/** The boot log line. */
export function describePasskeys(config: PasskeyConfig | null): string {
  return config
    ? `[auth] passkeys on for ${config.rpId} (origin ${config.origin})`
    : '[auth] passkeys off (WEBAUTHN_RP_ID not set)'
}
