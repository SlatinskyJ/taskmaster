import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { bundleWorker, PLACEHOLDER, serviceWorkerPlugin, shellBuild, SW_FILE } from './vite-plugin'

// Runs the real bundled sw.js against fake worker globals: install, activate and fetch.

type Listener = (event: FakeEvent) => void

interface FakeEvent {
  request?: Request
  waitUntil(promise: Promise<unknown>): void
  respondWith(response: Promise<Response>): void
}

class FakeCaches {
  readonly stores = new Map<string, Map<string, Response>>()
  open(name: string) {
    const store = this.stores.get(name) ?? new Map<string, Response>()
    this.stores.set(name, store)
    return Promise.resolve({
      addAll: async (requests: Request[]) => {
        for (const request of requests) store.set(request.url, await fakeFetch(request))
      },
      match: (request: Request) => Promise.resolve(store.get(request.url)?.clone()),
      put: (request: Request, response: Response) => {
        store.set(request.url, response)
        return Promise.resolve()
      },
    })
  }
  keys() {
    return Promise.resolve([...this.stores.keys()])
  }
  delete(name: string) {
    return Promise.resolve(this.stores.delete(name))
  }
}

const ORIGIN = 'https://tm.example'
let online = true
/** Status the fake server answers per path; 200 when not listed. */
const statusOf = new Map<string, number>()
const fetched: string[] = []
function fakeFetch(input: Request | string): Promise<Response> {
  const url = typeof input === 'string' ? input : input.url
  const path = new URL(url, ORIGIN).pathname
  fetched.push(path)
  if (!online) return Promise.reject(new TypeError('Failed to fetch'))
  return Promise.resolve(new Response(`body of ${url}`, { status: statusOf.get(path) ?? 200 }))
}

afterEach(() => {
  online = true
  statusOf.clear()
  fetched.length = 0
})

let workerCode = ''
beforeAll(async () => {
  workerCode = await bundleWorker()
}, 30_000)

/** Runs a worker built with the given data, or the given finished sw.js source. */
function startWorker(version: string, caches: FakeCaches, source?: string) {
  const listeners = new Map<string, Listener>()
  const calls = { skipWaiting: 0, claim: 0 }
  const self = {
    location: new URL(ORIGIN),
    skipWaiting: () => {
      calls.skipWaiting++
      return Promise.resolve()
    },
    clients: {
      claim: () => {
        calls.claim++
        return Promise.resolve()
      },
    },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  }
  const build = {
    version,
    precache: ['/manifest.webmanifest', '/assets/index-abc.js'],
    offlineHtml: '<p>offline</p>',
  }
  const code = source ?? workerCode.replaceAll(PLACEHOLDER, () => JSON.stringify(build))
  // In a worker, relative URLs resolve against the worker's origin.
  class WorkerRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init)
    }
  }
  runInNewContext(code, { self, caches, fetch: fakeFetch, URL, Response, Request: WorkerRequest })

  async function dispatch(type: string, request?: Request) {
    let waited: Promise<unknown> = Promise.resolve()
    let response: Promise<Response> | undefined
    listeners.get(type)?.({
      request,
      waitUntil: (promise) => {
        waited = promise
      },
      respondWith: (promise) => {
        response = promise
      },
    })
    await waited
    return response ? await response : undefined
  }
  return { dispatch, calls }
}

const navigate = (path: string) =>
  ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate' }) as Request
const get = (path: string) => new Request(`${ORIGIN}${path}`)

describe('service worker', () => {
  it('bundles into one classic script with no imports', () => {
    expect(workerCode).toContain(PLACEHOLDER)
    expect(workerCode).not.toMatch(/\bimport\s*[({"'`]|\bimport\s+\w|\bexport\s/)
  })

  it('precaches the shell into a versioned cache and takes over at once', async () => {
    const caches = new FakeCaches()
    const { dispatch, calls } = startWorker('v1', caches)
    await dispatch('install')
    await dispatch('activate')
    expect([...(caches.stores.get('tm-shell-v1')?.keys() ?? [])]).toEqual([
      `${ORIGIN}/manifest.webmanifest`,
      `${ORIGIN}/assets/index-abc.js`,
    ])
    expect(calls).toEqual({ skipWaiting: 1, claim: 1 })
  })

  it('a new build deletes the old shell cache on activate', async () => {
    const caches = new FakeCaches()
    const first = startWorker('v1', caches)
    await first.dispatch('install')
    await first.dispatch('activate')
    const second = startWorker('v2', caches)
    await second.dispatch('install')
    expect([...caches.stores.keys()]).toEqual(['tm-shell-v1', 'tm-shell-v2'])
    await second.dispatch('activate')
    expect([...caches.stores.keys()]).toEqual(['tm-shell-v2'])
  })

  it('serves cached assets without the network', async () => {
    const caches = new FakeCaches()
    const { dispatch } = startWorker('v1', caches)
    await dispatch('install')
    online = false
    const response = await dispatch('fetch', get('/assets/index-abc.js'))
    expect(await response?.text()).toBe(`body of ${ORIGIN}/assets/index-abc.js`)
  })

  it('stores a cache miss only when the server answers ok', async () => {
    const caches = new FakeCaches()
    const { dispatch } = startWorker('v1', caches)
    await dispatch('install')
    const font = `${ORIGIN}/assets/font-x.woff2`
    const store = () => caches.stores.get('tm-shell-v1')

    statusOf.set('/assets/font-x.woff2', 500)
    const failed = await dispatch('fetch', get('/assets/font-x.woff2'))
    expect(failed?.status).toBe(500)
    expect(store()?.has(font)).toBe(false)

    statusOf.delete('/assets/font-x.woff2')
    const ok = await dispatch('fetch', get('/assets/font-x.woff2'))
    expect(ok?.status).toBe(200)
    expect(store()?.has(font)).toBe(true)

    fetched.length = 0
    online = false
    const cached = await dispatch('fetch', get('/assets/font-x.woff2'))
    expect(await cached?.text()).toBe(`body of ${font}`)
    expect(fetched).toEqual([])
  })

  it('does not intercept API or server-function requests', async () => {
    const { dispatch } = startWorker('v1', new FakeCaches())
    expect(await dispatch('fetch', get('/api/health'))).toBeUndefined()
    expect(await dispatch('fetch', get('/_serverFn/x'))).toBeUndefined()
    const post = new Request(`${ORIGIN}/_serverFn/x`, { method: 'POST' })
    expect(await dispatch('fetch', post)).toBeUndefined()
  })

  it('loads pages from the network and never stores them', async () => {
    const caches = new FakeCaches()
    const { dispatch } = startWorker('v1', caches)
    const response = await dispatch('fetch', navigate('/'))
    expect(response?.status).toBe(200)
    expect(caches.stores.size).toBe(0)
  })

  it('shows the offline page when a navigation fails', async () => {
    online = false
    const { dispatch } = startWorker('v1', new FakeCaches())
    const response = await dispatch('fetch', navigate('/'))
    expect(response?.status).toBe(503)
    expect(await response?.text()).toBe('<p>offline</p>')
  })
})

describe('shellBuild', () => {
  const files = ['assets/b-2.js', 'assets/a-1.css', 'assets/font-x.woff2', 'assets/b-2.js.map']
  const read = (path: string) => `content of ${path}`

  it('precaches the shell files plus scripts and styles, not fonts or maps', () => {
    expect(shellBuild(files, read).precache).toEqual([
      '/manifest.webmanifest',
      '/icons/icon.svg',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/maskable-512.png',
      '/icons/apple-touch-icon.png',
      '/assets/a-1.css',
      '/assets/b-2.js',
    ])
  })

  it('changes the version when any asset or shell file changes, and only then', () => {
    const base = shellBuild(files, read).version
    expect(shellBuild([...files].reverse(), read).version).toBe(base)
    expect(shellBuild(['assets/b-3.js', ...files.slice(1)], read).version).not.toBe(base)
    expect(shellBuild(files, (path) => `new ${path}`).version).not.toBe(base)
  })
})

describe('serviceWorkerPlugin', () => {
  const publicDir = fileURLToPath(new URL('../../public', import.meta.url))

  async function emit(bundleFiles: string[]) {
    const plugin = serviceWorkerPlugin()
    const emitted: { type: string; fileName: string; source: string }[] = []
    const configResolved = plugin.configResolved as (config: { publicDir: string }) => void
    configResolved({ publicDir })
    const generateBundle = plugin.generateBundle as (
      this: { emitFile(file: { type: string; fileName: string; source: string }): string },
      options: unknown,
      bundle: Record<string, unknown>,
    ) => Promise<void>
    const bundle = Object.fromEntries(bundleFiles.map((file) => [file, {}]))
    await generateBundle.call(
      {
        emitFile: (file) => {
          emitted.push(file)
          return file.fileName
        },
      },
      {},
      bundle,
    )
    return { plugin, emitted }
  }

  it('runs only in the client build', () => {
    const plugin = serviceWorkerPlugin()
    const applies = plugin.applyToEnvironment as (environment: { name: string }) => boolean
    expect(plugin.apply).toBe('build')
    expect(applies({ name: 'client' })).toBe(true)
    expect(applies({ name: 'ssr' })).toBe(false)
  })

  it('emits a sw.js filled with this build, which precaches the bundle', async () => {
    const { emitted } = await emit(['assets/main-1.js', 'assets/app-2.css', 'assets/f-3.woff2'])
    expect(emitted.map((file) => [file.type, file.fileName])).toEqual([['asset', SW_FILE]])
    const source = emitted[0]?.source ?? ''
    expect(source).not.toContain(PLACEHOLDER)
    expect(source).toContain(cs.offline.title)

    const caches = new FakeCaches()
    const { dispatch } = startWorker('unused', caches, source)
    await dispatch('install')
    const [name] = [...caches.stores.keys()]
    expect(name).toMatch(/^tm-shell-[0-9a-f]{16}$/)
    expect([...(caches.stores.get(name ?? '')?.keys() ?? [])]).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/manifest.webmanifest`,
        `${ORIGIN}/assets/main-1.js`,
        `${ORIGIN}/assets/app-2.css`,
      ]),
    )
  }, 30_000)
})
