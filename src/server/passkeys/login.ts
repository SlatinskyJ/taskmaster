import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { LoginSuccess } from '~/server/auth'
import { limitKeys, releaseAttempt, reserveAttempt } from '~/server/auth/rateLimit'
import { createSession, pruneExpiredSessions, toCurrentUser } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { passkeys, users } from '~/server/db/schema'
import { consumeChallenge, issueChallenge } from './challenges'
import type { PasskeyConfig } from './config'

// Logging in with a passkey (spec §11 Passkeys): no username, the phone offers its passkeys
// for this site. Success opens the same kind of session as a password login (method `passkey`).

export type PasskeyLoginError =
  'busy' | 'rate_limited' | 'expired_challenge' | 'unknown_passkey' | 'not_verified'

/** Why a failure happened, for the audit log; the caller sees the error code. */
type FailureReason = Exclude<PasskeyLoginError, 'busy' | 'rate_limited'> | 'inactive'

const TIMEOUT_MS = 120_000

export async function startPasskeyLogin(
  db: Db,
  ip: string,
  config: PasskeyConfig,
  now: Date,
): Promise<Result<{ token: string; options: PublicKeyCredentialRequestOptionsJSON }, 'busy'>> {
  const issued = issueChallenge(db, { purpose: 'login', ip }, now)
  if (!issued) return fail('busy')
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    challenge: Buffer.from(issued.challenge, 'base64url'),
    allowCredentials: [],
    userVerification: 'required',
    timeout: TIMEOUT_MS,
  })
  return ok({ token: issued.token, options })
}

export interface FinishPasskeyLoginInput {
  /** The challenge cookie's token. */
  token: string
  response: AuthenticationResponseJSON
  /** Client IP as seen by the server (see ~/server/auth/http `clientIp`). */
  ip: string
}

export async function finishPasskeyLogin(
  db: Db,
  input: FinishPasskeyLoginInput,
  config: PasskeyConfig,
  now: Date,
): Promise<Result<LoginSuccess, PasskeyLoginError>> {
  const refuse = (reason: FailureReason, userId: number | null) => {
    db.transaction((tx) => {
      writeAudit(tx, {
        actor: { kind: 'anonymous' },
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: userId ?? 'unknown',
        after: { method: 'passkey', reason, ip: input.ip },
        at: now,
      })
    })
    return fail(reason === 'inactive' ? 'not_verified' : reason)
  }

  // Used up first: one answer per challenge, whatever happens next.
  const challenge = consumeChallenge(db, input.token, 'login', now)
  if (!challenge) return refuse('expired_challenge', null)
  const passkey = db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, input.response.id))
    .get()
  // Not counted in the rate limit: a phone offering a stale passkey must not use up the
  // family's shared per-IP allowance. Each try costs a challenge, which is capped per IP.
  if (!passkey) return refuse('unknown_passkey', null)

  // Counted in advance and taken back on success, like a password (see reserveAttempt).
  // A refusal here is not logged: past the limit the log would grow at the attacker's pace.
  const attempt = reserveAttempt(db, limitKeys(`passkey:${String(passkey.id)}`, input.ip), now)
  if (!attempt) return fail('rate_limited')

  const handle = input.response.response.userHandle
  if (handle !== undefined && handle !== passkey.userHandle) {
    return refuse('not_verified', passkey.userId)
  }
  let info
  try {
    const verified = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        ...(passkey.transports ? { transports: JSON.parse(passkey.transports) as string[] } : {}),
      },
    })
    // A counter that went backwards throws (a cloned authenticator): not verified.
    if (!verified.verified) return refuse('not_verified', passkey.userId)
    info = verified.authenticationInfo
  } catch {
    return refuse('not_verified', passkey.userId)
  }

  const opened = db.transaction((tx) => {
    // The verify was async: the passkey may have been removed, or the user deactivated, since.
    const current = tx.select().from(passkeys).where(eq(passkeys.id, passkey.id)).get()
    if (!current) return 'unknown_passkey' as const
    const user = tx.select().from(users).where(eq(users.id, current.userId)).get()
    if (!user?.active) return 'inactive' as const
    releaseAttempt(tx, attempt)
    tx.update(passkeys)
      .set({
        counter: info.newCounter,
        lastUsedAt: toIsoUtc(now),
        backedUp: info.credentialBackedUp,
      })
      .where(eq(passkeys.id, current.id))
      .run()
    pruneExpiredSessions(tx, now)
    const created = createSession(tx, user.id, 'passkey', now)
    writeAudit(tx, {
      actor: { kind: 'user', userId: user.id },
      action: 'auth.login_succeeded',
      entityType: 'session',
      entityId: created.session.id,
      after: { method: 'passkey', ip: input.ip, passkeyId: current.id },
      at: now,
    })
    return { ...created, user: toCurrentUser(user) }
  })
  if (opened === 'unknown_passkey') return refuse('unknown_passkey', passkey.userId)
  if (opened === 'inactive') return refuse('inactive', passkey.userId)
  return ok({
    token: opened.token,
    expiresAt: new Date(opened.session.expiresAt),
    user: opened.user,
  })
}
