import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOT_KEY,
  createInstallStore,
  getInstallMode,
  installApp,
  installBootScript,
  installMode,
  readInstallEnv,
  subscribeInstall,
  type InstallEnv,
  type PromptEvent,
} from './install'

// Install mode and the captured `beforeinstallprompt` (#302). Clicks and the boot script in a
// real page are exercised in e2e/install.spec.ts.

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
}

const env = (over: Partial<InstallEnv>): InstallEnv => ({
  standalone: false,
  userAgent: UA.android,
  maxTouchPoints: 0,
  hasPrompt: false,
  ...over,
})

describe('installMode', () => {
  it('already running from the home screen: hidden, even with a prompt on an iPhone', () => {
    expect(
      installMode(env({ standalone: true, hasPrompt: true, userAgent: UA.iphoneSafari })),
    ).toBe('hidden')
  })

  it('Chrome on Android: prompt while the event is held, hidden without it', () => {
    expect(installMode(env({ userAgent: UA.android, hasPrompt: true }))).toBe('prompt')
    expect(installMode(env({ userAgent: UA.android, hasPrompt: false }))).toBe('hidden')
  })

  it('iPhone Safari and iPhone Chrome get the steps', () => {
    expect(installMode(env({ userAgent: UA.iphoneSafari }))).toBe('ios')
    expect(installMode(env({ userAgent: UA.iphoneChrome }))).toBe('ios')
  })

  it('a Mac user agent with touch is an iPad; without touch it is a Mac', () => {
    expect(installMode(env({ userAgent: UA.mac, maxTouchPoints: 5 }))).toBe('ios')
    expect(installMode(env({ userAgent: UA.mac, maxTouchPoints: 0 }))).toBe('hidden')
  })

  it('Firefox on Windows: hidden', () => {
    expect(installMode(env({ userAgent: UA.firefoxWindows }))).toBe('hidden')
  })
})

interface FakeWindow extends EventTarget {
  [BOOT_KEY]?: unknown
  navigator: { userAgent: string; maxTouchPoints: number; standalone?: boolean }
  matchMedia: (query: string) => { matches: boolean }
}

function fakeWindow({
  userAgent = UA.android,
  maxTouchPoints = 0,
  standaloneQuery = false,
  navigatorStandalone,
  boot,
}: {
  userAgent?: string
  maxTouchPoints?: number
  standaloneQuery?: boolean
  navigatorStandalone?: boolean
  boot?: unknown
} = {}): FakeWindow {
  const win = new EventTarget() as FakeWindow
  win.navigator = { userAgent, maxTouchPoints }
  if (navigatorStandalone !== undefined) win.navigator.standalone = navigatorStandalone
  win.matchMedia = (query) => ({
    matches: standaloneQuery && query === '(display-mode: standalone)',
  })
  if (boot !== undefined) win[BOOT_KEY] = boot
  return win
}

function promptEvent(
  outcome: 'accepted' | 'dismissed' = 'dismissed',
  { fails = false } = {},
): PromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as PromptEvent
  event.prompt = vi.fn(() => (fails ? Promise.reject(new Error('not allowed')) : Promise.resolve()))
  Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome }) })
  return event
}

const asWindow = (win: FakeWindow) => win as unknown as Window

describe('createInstallStore', () => {
  it('an event caught by the boot script: prompt', () => {
    const store = createInstallStore(asWindow(fakeWindow({ boot: promptEvent() })))
    expect(store.getSnapshot()).toBe('prompt')
  })

  it('an event fired later: prompt, and subscribers hear it', () => {
    const win = fakeWindow()
    const store = createInstallStore(asWindow(win))
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.getSnapshot()).toBe('hidden')
    const event = promptEvent()
    win.dispatchEvent(event)
    expect(store.getSnapshot()).toBe('prompt')
    expect(listener).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('install() prompts once; dismissed uses the event up', async () => {
    const event = promptEvent('dismissed')
    const prompt = vi.spyOn(event, 'prompt')
    const store = createInstallStore(asWindow(fakeWindow({ boot: event })))
    const listener = vi.fn()
    store.subscribe(listener)
    await store.install()
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe('hidden')
    expect(listener).toHaveBeenCalled()
  })

  it('accepted uses the event up too', async () => {
    const store = createInstallStore(asWindow(fakeWindow({ boot: promptEvent('accepted') })))
    await store.install()
    expect(store.getSnapshot()).toBe('hidden')
  })

  it('appinstalled: hidden', () => {
    const win = fakeWindow({ boot: promptEvent() })
    const store = createInstallStore(asWindow(win))
    win.dispatchEvent(new Event('appinstalled'))
    expect(store.getSnapshot()).toBe('hidden')
  })

  it('appinstalled hides the iOS steps as well', () => {
    const win = fakeWindow({ userAgent: UA.iphoneSafari })
    const store = createInstallStore(asWindow(win))
    expect(store.getSnapshot()).toBe('ios')
    win.dispatchEvent(new Event('appinstalled'))
    expect(store.getSnapshot()).toBe('hidden')
  })

  it('boot key "installed": hidden', () => {
    const store = createInstallStore(
      asWindow(fakeWindow({ boot: 'installed', userAgent: UA.iphoneSafari })),
    )
    expect(store.getSnapshot()).toBe('hidden')
  })

  it('prompt() rejects: install() resolves, warns, and the section hides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = createInstallStore(
      asWindow(fakeWindow({ boot: promptEvent('dismissed', { fails: true }) })),
    )
    await expect(store.install()).resolves.toBeUndefined()
    expect(store.getSnapshot()).toBe('hidden')
    expect(warn).toHaveBeenCalledWith('[pwa] install prompt failed', expect.any(Error))
    warn.mockRestore()
  })

  it('install() with no event does nothing', async () => {
    const store = createInstallStore(asWindow(fakeWindow()))
    const listener = vi.fn()
    store.subscribe(listener)
    await expect(store.install()).resolves.toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
  })

  it('the snapshot is stable between events', () => {
    const store = createInstallStore(asWindow(fakeWindow({ userAgent: UA.iphoneSafari })))
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('unsubscribe stops notifications', () => {
    const win = fakeWindow()
    const store = createInstallStore(asWindow(win))
    const listener = vi.fn()
    const off = store.subscribe(listener)
    off()
    win.dispatchEvent(promptEvent())
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('installBootScript', () => {
  it('keeps the event and prevents the mini-infobar; marks appinstalled', () => {
    const win = fakeWindow()
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script ships as a string
    const run = new Function('window', installBootScript) as (win: FakeWindow) => void
    run(win)
    const event = promptEvent()
    win.dispatchEvent(event)
    expect(win[BOOT_KEY]).toBe(event)
    expect(event.defaultPrevented).toBe(true)
    win.dispatchEvent(new Event('appinstalled'))
    expect(win[BOOT_KEY]).toBe('installed')
  })
})

describe('readInstallEnv', () => {
  it('carries maxTouchPoints, so an iPad on a Mac user agent gets the steps', () => {
    const read = readInstallEnv(
      asWindow(fakeWindow({ userAgent: UA.mac, maxTouchPoints: 5 })),
      false,
    )
    expect(read).toEqual({
      standalone: false,
      userAgent: UA.mac,
      maxTouchPoints: 5,
      hasPrompt: false,
    })
    expect(installMode(read)).toBe('ios')
  })

  it('standalone from the display-mode query', () => {
    expect(readInstallEnv(asWindow(fakeWindow({ standaloneQuery: true })), true).standalone).toBe(
      true,
    )
  })

  it('standalone from navigator.standalone (iOS) when the query does not match', () => {
    expect(
      readInstallEnv(asWindow(fakeWindow({ navigatorStandalone: true })), false).standalone,
    ).toBe(true)
  })

  it('neither: not standalone', () => {
    expect(
      readInstallEnv(asWindow(fakeWindow({ navigatorStandalone: false })), false).standalone,
    ).toBe(false)
    expect(readInstallEnv(asWindow(fakeWindow()), false).standalone).toBe(false)
  })
})

describe('server-safe functions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('without a window: hidden, a no-op unsubscribe, a resolved install', async () => {
    vi.stubGlobal('window', undefined)
    expect(getInstallMode()).toBe('hidden')
    const off = subscribeInstall(() => undefined)
    expect(typeof off).toBe('function')
    off()
    await expect(installApp()).resolves.toBeUndefined()
  })
})
