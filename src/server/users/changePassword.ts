import { eq } from 'drizzle-orm'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from '~/lib/userLimits'
import { writeAudit } from '~/server/audit'
import { hashPassword, verifyPassword } from '~/server/auth/password'
import { limitKeys, releaseAttempt, reserveAttempt } from '~/server/auth/rateLimit'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { setOwnPasswordHash } from './manage'

// Changing your own password on Profil (spec §6, #210). Checks the current password under the
// login rate limit (same keys, so wrong tries here also block logins for that name), hashes the
// new one, then writes it through ./manage in one transaction with its audit entry. Imports
// auth's modules directly, not its index: the dependency stays one-way, users → auth.

export type ChangePasswordError =
  /** The new password is shorter than 8 or longer than 256 characters. */
  | 'invalid_password'
  | 'wrong_password'
  | 'rate_limited'
  /** The password or the calling session changed while the password was being checked. */
  | 'changed'

export interface ChangePasswordInput {
  userId: number
  /** The session making the request; it always stays. */
  sessionId: number
  current: string
  next: string
  logOutOthers: boolean
  /** Client IP as seen by the server. */
  ip: string
}

export async function changeOwnPassword(
  db: Db,
  input: ChangePasswordInput,
  now: Date = new Date(),
): Promise<Result<{ sessionsEnded: number }, ChangePasswordError>> {
  if (input.next.length < MIN_USER_PASSWORD || input.next.length > MAX_PASSWORD_LENGTH) {
    return fail('invalid_password')
  }
  const user = db.select().from(users).where(eq(users.id, input.userId)).get()
  if (!user) return fail('wrong_password')
  // Counted as a failure now, taken back when the password is right (see reserveAttempt).
  const attempt = reserveAttempt(db, limitKeys(user.username, input.ip), now)
  if (!attempt) return fail('rate_limited')

  const verifiedHash = user.passwordHash
  const matches =
    verifiedHash !== null &&
    input.current.length <= MAX_PASSWORD_LENGTH &&
    (await verifyPassword(verifiedHash, input.current))
  if (!matches) {
    db.transaction((tx) => {
      writeAudit(tx, {
        actor: { kind: 'user', userId: user.id },
        action: 'auth.password_change_failed',
        entityType: 'user',
        entityId: user.id,
        after: { ip: input.ip },
        at: now,
      })
    })
    return fail('wrong_password')
  }

  const passwordHash = await hashPassword(input.next)
  const written = db.transaction((tx) => {
    // The password was right, whatever happens next.
    releaseAttempt(tx, attempt)
    return setOwnPasswordHash(
      tx,
      user.id,
      input.sessionId,
      verifiedHash,
      passwordHash,
      input.logOutOthers,
      now,
    )
  })
  if (!written.ok) return fail(written.error === 'changed' ? 'changed' : 'wrong_password')
  return ok(written.value)
}
