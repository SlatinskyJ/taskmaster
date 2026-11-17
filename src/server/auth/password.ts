import { hash, hashSync, verify } from '@node-rs/argon2'

// Passwords (spec §6, §11 Auth): argon2id with the library defaults (argon2id, m=19 MiB, t=2,
// p=1: the OWASP minimum). Only the PHC string is stored; the password never is.

/** Longer input is refused before hashing, so a huge body can't keep the CPU busy. */
export const MAX_PASSWORD_LENGTH = 256

export function hashPassword(password: string): Promise<string> {
  return hash(password)
}

/** True when `password` matches the PHC string. A malformed hash counts as no match. */
export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password)
  } catch {
    return false
  }
}

let dummy: string | undefined

/**
 * A real hash of a random-ish value, verified when the username is unknown, so a wrong
 * username takes as long as a wrong password and doesn't reveal who has an account.
 */
export function dummyHash(): string {
  dummy ??= hashSync(`no-such-user-${String(process.pid)}-${String(Date.now())}`)
  return dummy
}
