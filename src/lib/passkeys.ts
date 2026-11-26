import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  sendSignal,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { useSyncExternalStore } from 'react'
import {
  passkeyLoginFn,
  passkeyLoginOptionsFn,
  passkeyRegisterFn,
  passkeyRegisterOptionsFn,
} from '~/server/passkeys/functions'
import type { PasskeyLoginResult } from '~/server/passkeys/functions'

// The browser side of passkeys (spec §11 Passkeys): asks the server for options, runs the
// WebAuthn ceremony, sends the answer back. Screens get a plain outcome and never touch
// WebAuthn themselves. A cancelled Face ID sheet is `cancelled`, so screens can stay quiet.

type CurrentUser = Extract<PasskeyLoginResult, { ok: true }>['user']

export type PasskeyLoginOutcome =
  /** `frameToken`: logged in inside a viewer frame (dev and previews, src/lib/frame.ts). */
  | { ok: true; user: CurrentUser; frameToken?: string }
  | { ok: false; reason: 'cancelled' | 'busy' | 'unknown' | 'rate_limited' | 'failed' }

export type PasskeyAddOutcome =
  { ok: true } | { ok: false; reason: 'cancelled' | 'already' | 'failed' }

/** Whether this browser can do WebAuthn at all. */
export const passkeysUsable = (): boolean => browserSupportsWebAuthn()

const noSubscribe = () => () => undefined

/** `passkeysUsable()` for a component: false in the server render, the real answer after. */
export function usePasskeysUsable(): boolean {
  return useSyncExternalStore(noSubscribe, passkeysUsable, () => false)
}

/** Whether this browser offers passkeys in the username field's autofill. */
export const autofillUsable = (): Promise<boolean> => browserSupportsWebAuthnAutofill()

const HERE_KEY = 'tm-passkey-here'
const hereListeners = new Set<() => void>()

/**
 * The id of the passkey this browser added, remembered locally so Profil can say which row is
 * this device (a per-device convenience: lost with site data, then Profil just doesn't mark it).
 */
export function thisDevicePasskey(): number | null {
  try {
    const n = Number(localStorage.getItem(HERE_KEY))
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function setThisDevicePasskey(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(HERE_KEY)
    else localStorage.setItem(HERE_KEY, String(id))
  } catch {
    // Storage blocked: nothing to remember.
  }
  for (const l of hereListeners) l()
}

function subscribeHere(onChange: () => void) {
  hereListeners.add(onChange)
  return () => {
    hereListeners.delete(onChange)
  }
}

/** `thisDevicePasskey()` for a component: null in the server render. */
export function useThisDevicePasskey(): number | null {
  return useSyncExternalStore(subscribeHere, thisDevicePasskey, () => null)
}

/** The user closed the sheet, or a newer ceremony replaced this one. */
function isCancel(e: unknown): boolean {
  return e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')
}

export async function loginWithPasskey(
  opts: { autofill?: boolean } = {},
): Promise<PasskeyLoginOutcome> {
  try {
    const started = await passkeyLoginOptionsFn()
    if (!started.ok) return { ok: false, reason: started.error === 'busy' ? 'busy' : 'failed' }
    const optionsJSON = JSON.parse(started.optionsJson) as PublicKeyCredentialRequestOptionsJSON
    let response
    try {
      response = await startAuthentication({
        optionsJSON,
        useBrowserAutofill: opts.autofill ?? false,
      })
    } catch (e) {
      return { ok: false, reason: isCancel(e) ? 'cancelled' : 'failed' }
    }
    const result = await passkeyLoginFn({ data: response })
    if (result.ok) {
      return result.frameToken === undefined
        ? { ok: true, user: result.user }
        : { ok: true, user: result.user, frameToken: result.frameToken }
    }
    switch (result.error) {
      case 'unknown_passkey':
        // Best effort: the phone stops offering a passkey the server no longer has.
        await sendSignal({
          signalName: 'unknownCredential',
          rpID: optionsJSON.rpId ?? location.hostname,
          credentialID: response.id,
        }).catch(() => undefined)
        return { ok: false, reason: 'unknown' }
      case 'rate_limited':
        return { ok: false, reason: 'rate_limited' }
      default:
        return { ok: false, reason: 'failed' }
    }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

export async function addPasskey(): Promise<PasskeyAddOutcome> {
  try {
    const started = await passkeyRegisterOptionsFn()
    if (!started.ok) return { ok: false, reason: 'failed' }
    const optionsJSON = JSON.parse(started.optionsJson) as PublicKeyCredentialCreationOptionsJSON
    let response
    try {
      response = await startRegistration({ optionsJSON })
    } catch (e) {
      // InvalidStateError: this device already holds one of the user's passkeys.
      if (e instanceof Error && e.name === 'InvalidStateError') {
        return { ok: false, reason: 'already' }
      }
      return { ok: false, reason: isCancel(e) ? 'cancelled' : 'failed' }
    }
    const result = await passkeyRegisterFn({ data: response })
    if (result.ok) {
      setThisDevicePasskey(result.passkey.id)
      return { ok: true }
    }
    return { ok: false, reason: result.error === 'already_registered' ? 'already' : 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/**
 * The login screen's two ways in, one ceremony at a time (the server keeps one challenge per
 * browser). Autofill waits quietly in the username field; the button replaces it. Autofill is
 * started again only after the button's ceremony was cancelled or failed: never from its own
 * outcome (the button's call aborts it, and restarting would abort the button in turn), and
 * never after `busy` (that would loop on a household's shared per-IP allowance).
 */
export function createLoginFlow(deps: {
  login: typeof loginWithPasskey
  onDone: (outcome: PasskeyLoginOutcome) => void
}): { startAutofill: () => void; clickButton: () => Promise<void> } {
  let autofillRunning = false
  let generation = 0

  function startAutofill() {
    if (autofillRunning) return
    autofillRunning = true
    const mine = ++generation
    void deps.login({ autofill: true }).then((outcome) => {
      // A button press since then owns the ceremony; this answer is stale.
      if (mine !== generation) return
      autofillRunning = false
      if (outcome.ok || outcome.reason === 'unknown' || outcome.reason === 'rate_limited') {
        deps.onDone(outcome)
      }
    })
  }

  async function clickButton() {
    generation++
    autofillRunning = false
    const outcome = await deps.login()
    deps.onDone(outcome)
    if (!outcome.ok && (outcome.reason === 'cancelled' || outcome.reason === 'failed')) {
      startAutofill()
    }
  }

  return { startAutofill, clickButton }
}
