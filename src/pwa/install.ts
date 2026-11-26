// Profil → Nainstalovat aplikaci (#302). Decides what the install row offers and holds the
// browser's single-use `beforeinstallprompt` event. Framework-free and server-safe; imports
// nothing from the worker side (./policy, ./sw).

export type InstallMode = 'hidden' | 'prompt' | 'ios'

export interface InstallEnv {
  standalone: boolean
  userAgent: string
  maxTouchPoints: number
  hasPrompt: boolean
}

/** The `beforeinstallprompt` event (Chrome, Edge, Android); not in the DOM typings. */
export interface PromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone) return 'hidden'
  if (env.hasPrompt) return 'prompt'
  // iPadOS 13+ reports a Mac user agent; a Mac has no touch points.
  const ios =
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (env.userAgent.includes('Macintosh') && env.maxTouchPoints > 1)
  return ios ? 'ios' : 'hidden'
}

export function readInstallEnv(win: Window, hasPrompt: boolean): InstallEnv {
  const nav = win.navigator as Navigator & { standalone?: boolean }
  return {
    standalone: win.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    hasPrompt,
  }
}

export const BOOT_KEY = '__tmInstallPrompt'

/**
 * Runs inline in <head>: the event can fire before React hydrates, long before Profil is open.
 * Keeps it on `window[BOOT_KEY]` (and stops Chrome's own mini-infobar); `'installed'` after
 * `appinstalled`. Serialised into the HTML as a string, so keep it tiny.
 */
export const installBootScript = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window['${BOOT_KEY}']=e});window.addEventListener('appinstalled',function(){window['${BOOT_KEY}']='installed'})`

export interface InstallStore {
  subscribe(cb: () => void): () => void
  getSnapshot(): InstallMode
  install(): Promise<void>
}

export function createInstallStore(win: Window): InstallStore {
  const boot = (win as unknown as Record<string, unknown>)[BOOT_KEY]
  let installed = boot === 'installed'
  let event: PromptEvent | null = boot && typeof boot === 'object' ? (boot as PromptEvent) : null
  const listeners = new Set<() => void>()
  let snapshot = compute()

  function compute(): InstallMode {
    return installed ? 'hidden' : installMode(readInstallEnv(win, event !== null))
  }
  function changed() {
    snapshot = compute()
    for (const listener of listeners) listener()
  }

  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    event = e as PromptEvent
    changed()
  })
  win.addEventListener('appinstalled', () => {
    installed = true
    event = null
    changed()
  })

  return {
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot: () => snapshot,
    async install() {
      const current = event
      if (!current) return
      try {
        await current.prompt()
        await current.userChoice
      } catch (error) {
        console.warn('[pwa] install prompt failed', error)
      }
      // Single-use whatever the outcome: no dead button until the browser fires a new one.
      if (event === current) event = null
      changed()
    },
  }
}

let store: InstallStore | undefined

function browserStore(): InstallStore | undefined {
  if (typeof window === 'undefined') return undefined
  store ??= createInstallStore(window)
  return store
}

export function subscribeInstall(cb: () => void): () => void {
  return browserStore()?.subscribe(cb) ?? (() => undefined)
}

export function getInstallMode(): InstallMode {
  return browserStore()?.getSnapshot() ?? 'hidden'
}

export function installApp(): Promise<void> {
  return browserStore()?.install() ?? Promise.resolve()
}
