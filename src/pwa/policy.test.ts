import { describe, expect, it } from 'vitest'
import { cacheName, SHELL_FILES, staleCaches, strategyFor } from './policy'

const origin = 'https://tm.example'
const get = (path: string, mode = 'cors') => ({ url: `${origin}${path}`, method: 'GET', mode })

describe('strategyFor', () => {
  it('caches hashed build assets and the shell files', () => {
    expect(strategyFor(get('/assets/index-DVeJC0-x.js', 'no-cors'), origin)).toBe('cache')
    expect(strategyFor(get('/assets/app-DIoWchp5.css'), origin)).toBe('cache')
    for (const path of SHELL_FILES) expect(strategyFor(get(path), origin)).toBe('cache')
  })

  it('sends HTML navigations to the network, never the cache', () => {
    expect(strategyFor(get('/', 'navigate'), origin)).toBe('navigation')
    expect(strategyFor(get('/sprava?tab=lide', 'navigate'), origin)).toBe('navigation')
  })

  it('never caches API routes or server functions (user data)', () => {
    expect(strategyFor(get('/api/health'), origin)).toBe('network')
    expect(strategyFor(get('/_serverFn/abc123'), origin)).toBe('network')
    expect(strategyFor(get('/_serverFn/abc123?payload=x'), origin)).toBe('network')
  })

  it('leaves writes alone, even to cacheable paths', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(strategyFor({ ...get('/_serverFn/abc'), method }, origin)).toBe('network')
      expect(strategyFor({ ...get('/assets/x.js'), method }, origin)).toBe('network')
    }
  })

  it('leaves other origins, query strings and unknown paths to the browser', () => {
    expect(strategyFor({ ...get('/x'), url: 'https://cdn.example/assets/a.js' }, origin)).toBe(
      'network',
    )
    expect(strategyFor(get('/assets/a.js?v=2'), origin)).toBe('network')
    expect(strategyFor(get('/sw.js'), origin)).toBe('network')
    expect(strategyFor(get('/robots.txt'), origin)).toBe('network')
    expect(strategyFor(get('/assetsX/a.js'), origin)).toBe('network')
  })

  it('leaves a frame’s page load to the browser, so it says Sec-Fetch-Dest: iframe (#274)', () => {
    expect(strategyFor({ ...get('/login', 'navigate'), destination: 'iframe' }, origin)).toBe(
      'network',
    )
    expect(strategyFor({ ...get('/?tmFrame=x', 'navigate'), destination: 'iframe' }, origin)).toBe(
      'network',
    )
  })

  it.each(['frame', 'embed', 'object'])(
    'leaves a nested %s page load to the browser too',
    (dest) => {
      expect(strategyFor({ ...get('/', 'navigate'), destination: dest }, origin)).toBe('network')
    },
  )

  it('still serves top-level page loads, with or without a destination', () => {
    expect(strategyFor({ ...get('/', 'navigate'), destination: 'document' }, origin)).toBe(
      'navigation',
    )
    expect(strategyFor(get('/', 'navigate'), origin)).toBe('navigation')
  })

  it('leaves a frame’s load from another origin to the browser, as before', () => {
    const other = { url: 'https://other.example/', method: 'GET', mode: 'navigate' }
    expect(strategyFor({ ...other, destination: 'iframe' }, origin)).toBe('network')
  })
})

describe('shell caches', () => {
  it('names the cache after the build version', () => {
    expect(cacheName('abc')).toBe('tm-shell-abc')
  })

  it('marks older shell caches stale, keeping the current one and foreign caches', () => {
    const names = ['tm-shell-old1', 'tm-shell-new', 'tm-shell-old2', 'other-cache']
    expect(staleCaches(names, 'new')).toEqual(['tm-shell-old1', 'tm-shell-old2'])
  })
})
