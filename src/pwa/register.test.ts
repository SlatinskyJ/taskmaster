import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerServiceWorker, type NavigationEvents } from './register'

// registerServiceWorker against fake navigator.serviceWorker, document, window and router.

type Listener = () => void
type NavigationListener = Parameters<NavigationEvents['subscribe']>[1]

function setup({ controller = true, prod = true, supported = true } = {}) {
  vi.stubEnv('PROD', prod)
  const containerListeners: Record<string, Listener[]> = {}
  const update = vi.fn(() => Promise.resolve())
  const register = vi.fn(() => Promise.resolve({ update }))
  const container = {
    controller: controller ? {} : null,
    register,
    addEventListener: (type: string, listener: Listener) => {
      ;(containerListeners[type] ??= []).push(listener)
    },
  }
  vi.stubGlobal('navigator', supported ? { serviceWorker: container } : {})

  const documentListeners: Record<string, Listener[]> = {}
  const document = {
    visibilityState: 'visible',
    addEventListener: (type: string, listener: Listener) => {
      ;(documentListeners[type] ??= []).push(listener)
    },
  }
  vi.stubGlobal('document', document)
  const replace = vi.fn()
  vi.stubGlobal('window', { location: { replace } })

  const navigationListeners: NavigationListener[] = []
  const router: NavigationEvents = {
    subscribe: (_type, listener) => {
      navigationListeners.push(listener)
      return () => undefined
    },
  }

  const fire = (listeners: Record<string, Listener[]>, type: string) => {
    for (const listener of listeners[type] ?? []) listener()
  }
  return {
    router,
    register,
    update,
    replace,
    document,
    takeOver: () => {
      fire(containerListeners, 'controllerchange')
    },
    showPage: (state: 'visible' | 'hidden') => {
      document.visibilityState = state
      fire(documentListeners, 'visibilitychange')
    },
    navigate: (href: string, hrefChanged = true) => {
      for (const listener of navigationListeners) listener({ hrefChanged, toLocation: { href } })
    },
  }
}

/** Lets the register() promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('registerServiceWorker', () => {
  it('registers /sw.js for the whole app, bypassing the HTTP cache', () => {
    const page = setup()
    registerServiceWorker(page.router)
    expect(page.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('does nothing outside production builds or without service worker support', () => {
    const dev = setup({ prod: false })
    registerServiceWorker(dev.router)
    expect(dev.register).not.toHaveBeenCalled()

    const unsupported = setup({ supported: false })
    expect(() => {
      registerServiceWorker(unsupported.router)
    }).not.toThrow()
  })

  it('after a new worker takes over, never reloads on the spot', () => {
    const page = setup()
    registerServiceWorker(page.router)
    page.takeOver()
    expect(page.replace).not.toHaveBeenCalled()
  })

  it('after a new worker takes over, makes the next navigation a full page load, once', () => {
    const page = setup()
    registerServiceWorker(page.router)
    page.navigate('/before')
    expect(page.replace).not.toHaveBeenCalled()

    page.takeOver()
    page.navigate('/', false) // a reload of the same location (router.invalidate)
    expect(page.replace).not.toHaveBeenCalled()
    page.navigate('/ukoly?tab=moje')
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('/ukoly?tab=moje')

    page.takeOver()
    page.navigate('/sprava')
    expect(page.replace).toHaveBeenCalledOnce()
  })

  it('keeps client-side navigation on the first visit, when the first worker takes over', () => {
    const page = setup({ controller: false })
    registerServiceWorker(page.router)
    page.takeOver()
    page.navigate('/ukoly')
    expect(page.replace).not.toHaveBeenCalled()
  })

  it('looks for a new deploy each time the app comes back to the foreground', async () => {
    const page = setup()
    registerServiceWorker(page.router)
    await settle()
    page.showPage('hidden')
    expect(page.update).not.toHaveBeenCalled()
    page.showPage('visible')
    page.showPage('visible')
    expect(page.update).toHaveBeenCalledTimes(2)
  })

  it('only warns when registration fails', async () => {
    const page = setup()
    page.register.mockImplementation(() => Promise.reject(new Error('blocked')))
    registerServiceWorker(page.router)
    await settle()
    expect(console.warn).toHaveBeenCalledOnce()
  })
})
