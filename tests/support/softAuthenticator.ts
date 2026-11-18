import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

// A software WebAuthn authenticator for tests: ES256 keys, attestation "none", always user
// present, user verified unless told otherwise, and flagged as a synced passkey (BE + BS). The
// server code under test runs the real @simplewebauthn/server verification against it.

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | Record<string, never>

function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n)
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n)
  if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff)
  const b = new Uint8Array(5)
  b[0] = (major << 5) | 26
  new DataView(b.buffer).setUint32(1, n)
  return b
}

/** Minimal CBOR: integers, byte strings, text strings, maps. Enough for attestation objects. */
function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value)
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value])
  const entries = value instanceof Map ? [...value.entries()] : []
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]),
  ])
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest()

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_BE = 0x08
const FLAG_BS = 0x10
const FLAG_AT = 0x40

interface StoredCredential {
  id: Uint8Array
  privateKey: KeyObject
  userHandle: string
  counter: number
}

export interface CeremonyFlags {
  userVerified?: boolean
  origin?: string
  rpId?: string
}

export class SoftAuthenticator {
  private readonly credentials: StoredCredential[] = []

  constructor(private readonly opts: { rpId: string; origin: string }) {}

  /** Credential ids this authenticator holds, base64url. */
  get ids(): string[] {
    return this.credentials.map((c) => b64u(c.id))
  }

  private authData(rpId: string, flags: number, counter: number, attested?: Uint8Array) {
    const c = Buffer.alloc(4)
    c.writeUInt32BE(counter)
    return Buffer.concat([sha256(rpId), Uint8Array.of(flags), c, attested ?? new Uint8Array()])
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  }

  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    flags: CeremonyFlags = {},
  ): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const jwk = publicKey.export({ format: 'jwk' })
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ])
    const id = randomBytes(16)
    const idLen = Buffer.alloc(2)
    idLen.writeUInt16BE(id.length)
    const attested = Buffer.concat([Buffer.alloc(16), idLen, id, cbor(coseKey)])
    const uv = flags.userVerified ?? true
    const authData = this.authData(
      flags.rpId ?? this.opts.rpId,
      FLAG_UP | (uv ? FLAG_UV : 0) | FLAG_BE | FLAG_BS | FLAG_AT,
      0,
      attested,
    )
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )
    this.credentials.push({ id, privateKey, userHandle: options.user.id, counter: 0 })
    return {
      id: b64u(id),
      rawId: b64u(id),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(
          this.clientData('webauthn.create', options.challenge, flags.origin ?? this.opts.origin),
        ),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /**
   * Signs a login challenge with a stored credential: the last one made, or `credentialId`.
   * The counter goes up by one per use unless `counter` is given.
   */
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    flags: CeremonyFlags & { counter?: number; credentialId?: string; userHandle?: string } = {},
  ): AuthenticationResponseJSON {
    const cred =
      flags.credentialId !== undefined
        ? this.credentials.find((c) => b64u(c.id) === flags.credentialId)
        : this.credentials.at(-1)
    if (!cred) throw new Error('no such credential')
    cred.counter = flags.counter ?? cred.counter + 1
    const uv = flags.userVerified ?? true
    const authData = this.authData(
      flags.rpId ?? this.opts.rpId,
      FLAG_UP | (uv ? FLAG_UV : 0) | FLAG_BE | FLAG_BS,
      cred.counter,
    )
    const clientData = this.clientData(
      'webauthn.get',
      options.challenge,
      flags.origin ?? this.opts.origin,
    )
    const signature = createSign('SHA256')
      .update(Buffer.concat([authData, sha256(clientData)]))
      .sign(cred.privateKey)
    return {
      id: b64u(cred.id),
      rawId: b64u(cred.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: flags.userHandle ?? cred.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /**
   * The same registration answered again for a new challenge. With attestation "none" the
   * client data is not signed, so this is what a replayed or duplicated registration looks like.
   */
  replay(
    response: RegistrationResponseJSON,
    options: PublicKeyCredentialCreationOptionsJSON,
  ): RegistrationResponseJSON {
    return {
      ...response,
      response: {
        ...response.response,
        clientDataJSON: b64u(
          this.clientData('webauthn.create', options.challenge, this.opts.origin),
        ),
      },
    }
  }

  /** A key this authenticator signs with but the server never saw. */
  forge(): void {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    this.credentials.push({
      id: randomBytes(16),
      privateKey,
      userHandle: b64u(randomBytes(32)),
      counter: 0,
    })
  }
}
