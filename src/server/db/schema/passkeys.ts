import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// Passkeys (spec §11 Passkeys, #29). One row per passkey a user registered: a phone, a laptop,
// a password manager. Only the public key is stored; the private key never leaves the device.
// Rows are deleted when a passkey is removed; the audit log keeps the history
// (passkey.registered / passkey.removed). The credential id and user handle are not secrets,
// but they are kept out of the audit log and of anything a server function returns.

/** What kind of device registered a passkey, guessed from its User-Agent. Labels live in the UI. */
export const DEVICE_KINDS = [
  'iphone',
  'ipad',
  'android',
  'mac',
  'windows',
  'linux',
  'other',
] as const
export type DeviceKind = (typeof DEVICE_KINDS)[number]

export const passkeys = sqliteTable(
  'passkeys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** The credential id as the browser sends it (base64url). */
    credentialId: text('credential_id').notNull().unique(),
    /** COSE public key. */
    publicKey: blob('public_key', { mode: 'buffer' }).notNull(),
    /** Signature counter the authenticator reported last (0 for most synced passkeys). */
    counter: integer('counter').notNull(),
    /** JSON array of transports (`internal`, `hybrid`, …), or null when the browser gave none. */
    transports: text('transports'),
    /** WebAuthn user handle (base64url): random, the same for all of one user's passkeys. */
    userHandle: text('user_handle').notNull(),
    // No CHECK on purpose: a new device kind must not need a table rebuild.
    deviceKind: text('device_kind', { enum: DEVICE_KINDS }).notNull(),
    /** The passkey is synced (iCloud Keychain, Google Password Manager…). */
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
    /** UTC instants, ISO 8601 with milliseconds. */
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)

export type PasskeyRow = typeof passkeys.$inferSelect

/** What a challenge is for: registering a passkey (signed in) or logging in with one. */
export const CHALLENGE_PURPOSES = ['register', 'login'] as const
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number]

// WebAuthn challenges waiting for the browser's answer. Single use: a row is deleted when its
// answer comes back (or when it expires). The browser holds a random token in a short-lived
// cookie; only its SHA-256 lands here.
export const passkeyChallenges = sqliteTable(
  'passkey_challenges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SHA-256 of the cookie token, hex. */
    tokenHash: text('token_hash').notNull().unique(),
    /** The challenge sent in the options (base64url). */
    challenge: text('challenge').notNull(),
    purpose: text('purpose', { enum: CHALLENGE_PURPOSES }).notNull(),
    /** Who is registering (`register` only). */
    userId: integer('user_id').references(() => users.id),
    /** The user handle put in the registration options (`register` only). */
    userHandle: text('user_handle'),
    /** SHA-256 of the client's IP prefix (`login` only), for the per-IP cap. Never the IP. */
    ipKey: text('ip_key'),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    index('passkey_challenges_expires_idx').on(t.expiresAt),
    index('passkey_challenges_ip_idx').on(t.ipKey),
    index('passkey_challenges_user_idx').on(t.userId),
  ],
)

export type PasskeyChallengeRow = typeof passkeyChallenges.$inferSelect
