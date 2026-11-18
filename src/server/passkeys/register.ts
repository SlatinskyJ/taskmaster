import { randomBytes } from 'node:crypto'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { desc, eq } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { passkeys } from '~/server/db/schema'
import type { DeviceKind, PasskeyRow } from '~/server/db/schema'
import { consumeChallenge, issueChallenge } from './challenges'
import type { PasskeyConfig } from './config'
import { guessDeviceKind } from './deviceKind'

// Registering a passkey (spec §11 Passkeys): only for a signed-in user (the server function's
// guard), always a discoverable credential with user verification (Face ID, fingerprint, PIN).

/** The only passkey shape that leaves the server: no credential id, key, counter or handle. */
export interface PasskeySummary {
  id: number
  deviceKind: DeviceKind
  createdAt: string
  lastUsedAt: string | null
  backedUp: boolean
}

export const toPasskeySummary = (p: PasskeyRow): PasskeySummary => ({
  id: p.id,
  deviceKind: p.deviceKind,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
  backedUp: p.backedUp,
})

export type RegisterError = 'busy' | 'expired_challenge' | 'not_verified' | 'already_registered'

/** EdDSA, ES256, RS256: pinned, so a library default can't add algorithms silently. */
const ALGORITHMS = [-8, -7, -257]
const TIMEOUT_MS = 120_000

export async function startRegistration(
  db: Db,
  user: CurrentUser,
  config: PasskeyConfig,
  now: Date,
): Promise<Result<{ token: string; options: PublicKeyCredentialCreationOptionsJSON }, 'busy'>> {
  const existing = db
    .select({
      credentialId: passkeys.credentialId,
      transports: passkeys.transports,
      userHandle: passkeys.userHandle,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
    .orderBy(desc(passkeys.id))
    .all()
  const userHandle = existing[0]?.userHandle ?? randomBytes(32).toString('base64url')
  const issued = issueChallenge(db, { purpose: 'register', userId: user.id, userHandle }, now)
  if (!issued) return fail('busy')
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: user.username,
    userDisplayName: user.displayName,
    userID: Buffer.from(userHandle, 'base64url'),
    challenge: Buffer.from(issued.challenge, 'base64url'),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      ...(p.transports ? { transports: JSON.parse(p.transports) as string[] } : {}),
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: ALGORITHMS,
    timeout: TIMEOUT_MS,
  })
  return ok({ token: issued.token, options })
}

export interface FinishRegistrationInput {
  /** The challenge cookie's token. */
  token: string
  response: RegistrationResponseJSON
  userAgent: string | undefined
}

export async function finishRegistration(
  db: Db,
  user: CurrentUser,
  input: FinishRegistrationInput,
  config: PasskeyConfig,
  now: Date,
): Promise<Result<PasskeySummary, RegisterError>> {
  // Used up first, so a failed verify can't be retried with the same challenge.
  const challenge = consumeChallenge(db, input.token, 'register', now)
  if (challenge?.userId !== user.id || challenge.userHandle === null) {
    return fail('expired_challenge')
  }
  let info
  try {
    const verified = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    })
    if (!verified.verified) return fail('not_verified')
    info = verified.registrationInfo
  } catch {
    return fail('not_verified')
  }
  const { credential } = info
  const userHandle = challenge.userHandle
  const at = toIsoUtc(now)
  const row = db.transaction((tx) => {
    const taken = tx
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.credentialId, credential.id))
      .get()
    if (taken) return null
    const inserted = tx
      .insert(passkeys)
      .values({
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        userHandle,
        deviceKind: guessDeviceKind(input.userAgent),
        backedUp: info.credentialBackedUp,
        createdAt: at,
      })
      .returning()
      .get()
    writeAudit(tx, {
      actor: { kind: 'user', userId: user.id },
      action: 'passkey.registered',
      entityType: 'passkey',
      entityId: inserted.id,
      after: { userId: user.id, deviceKind: inserted.deviceKind, backedUp: inserted.backedUp },
      at: now,
    })
    return inserted
  })
  if (!row) return fail('already_registered')
  return ok(toPasskeySummary(row))
}
