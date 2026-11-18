import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

// Validators for what the browser sends to the passkey server functions. They check the shape
// @simplewebauthn/server reads; the library then checks the content (signature, challenge,
// origin, RP ID). Anything else throws, like parseLoginForm.

/** Longest credential id: 1023 bytes as base64url. */
export const MAX_ID_LENGTH = 1366
/** A response is a few hundred bytes; anything this big is not one. */
export const MAX_BODY_LENGTH = 16 * 1024

const B64URL = /^[A-Za-z0-9_-]*$/

function invalid(): never {
  throw new Error('Invalid passkey response')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function b64(value: unknown, max = MAX_BODY_LENGTH): string {
  if (typeof value !== 'string' || value.length > max || !B64URL.test(value)) invalid()
  return value
}

function credential(data: unknown): Record<string, unknown> {
  const c = record(data)
  if (JSON.stringify(c).length > MAX_BODY_LENGTH) invalid()
  b64(c.id, MAX_ID_LENGTH)
  b64(c.rawId, MAX_ID_LENGTH)
  if (c.type !== 'public-key') invalid()
  record(c.clientExtensionResults)
  if (c.authenticatorAttachment !== undefined && typeof c.authenticatorAttachment !== 'string') {
    invalid()
  }
  return c
}

export function parseRegistrationResponse(data: unknown): RegistrationResponseJSON {
  const c = credential(data)
  const r = record(c.response)
  b64(r.clientDataJSON)
  b64(r.attestationObject)
  if (r.authenticatorData !== undefined) b64(r.authenticatorData)
  if (r.publicKey !== undefined) b64(r.publicKey)
  if (r.publicKeyAlgorithm !== undefined && !Number.isSafeInteger(r.publicKeyAlgorithm)) invalid()
  if (
    r.transports !== undefined &&
    !(Array.isArray(r.transports) && r.transports.every((t) => typeof t === 'string'))
  ) {
    invalid()
  }
  return c as unknown as RegistrationResponseJSON
}

export function parseAuthenticationResponse(data: unknown): AuthenticationResponseJSON {
  const c = credential(data)
  const r = record(c.response)
  b64(r.clientDataJSON)
  b64(r.authenticatorData)
  b64(r.signature)
  if (r.userHandle !== undefined) b64(r.userHandle)
  return c as unknown as AuthenticationResponseJSON
}

/** `{ [key]: n }` with n a positive safe integer. */
export function parseId(data: unknown, key: 'passkeyId' | 'userId'): number {
  const value = record(data)[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid()
  return value
}
