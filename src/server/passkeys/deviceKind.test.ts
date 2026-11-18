import { describe, expect, it } from 'vitest'
import { guessDeviceKind } from './deviceKind'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
} as const

describe('guessDeviceKind', () => {
  it.each(Object.entries(UA))('%s', (kind, ua) => {
    expect(guessDeviceKind(ua)).toBe(kind)
  })

  it('unknown or missing → other', () => {
    expect(guessDeviceKind(undefined)).toBe('other')
    expect(guessDeviceKind('')).toBe('other')
    expect(guessDeviceKind('curl/8.0')).toBe('other')
  })
})
