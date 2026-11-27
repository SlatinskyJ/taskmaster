import { describe, expect, it } from 'vitest'
import { demoLinkInput, stripLinks, stripLinksDeep } from './links'

const DEMO = { TASKMASTER_ENV: 'demo' }

describe('stripLinks', () => {
  it('removes a link up to the next whitespace, keeping the spaces around it', () => {
    expect(stripLinks('viz https://evil.cz/x?a=1 teď')).toBe('viz  teď')
  })

  it('removes www. and http:// in any case', () => {
    expect(stripLinks('WWW.Evil.CZ a http://x')).toBe(' a ')
    expect(stripLinks('HTTPS://X.CZ b Http://y')).toBe(' b ')
  })

  it('removes a link glued to text, with the punctuation after it', () => {
    expect(stripLinks('viz:https://x.cz,')).toBe('viz:')
    expect(stripLinks('a\nwww.x.cz\tb')).toBe('a\n\tb')
  })

  it('keeps a plain domain and ordinary text', () => {
    expect(stripLinks('evil.cz a atd.')).toBe('evil.cz a atd.')
    expect(stripLinks('http bez dvojtečky, wwwx')).toBe('http bez dvojtečky, wwwx')
    expect(stripLinks('')).toBe('')
  })
})

describe('stripLinksDeep', () => {
  it('strips every string in nested input and leaves other values alone', () => {
    expect(
      stripLinksDeep({
        title: 'a www.x.cz',
        days: [{ note: 'http://y z' }],
        n: 3,
        ok: true,
        x: null,
      }),
    ).toEqual({ title: 'a ', days: [{ note: ' z' }], n: 3, ok: true, x: null })
    expect(stripLinksDeep(['www.a', 1, ['http://b c']])).toEqual(['', 1, [' c']])
    expect(stripLinksDeep(undefined)).toBeUndefined()
  })

  it('keeps a __proto__ key as a plain own key and leaves Object.prototype alone', () => {
    const out = stripLinksDeep(JSON.parse('{"__proto__":{"a":"www.x"}}')) as object
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ a: '' })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).a).toBeUndefined()
  })

  it('leaves values that are not plain objects as they are', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { t: 'a www.x b' })
    expect(stripLinksDeep(bare)).toEqual({ t: 'a  b' })
    const date = new Date(0)
    expect(stripLinksDeep(date)).toBe(date)
  })
})

describe('demoLinkInput', () => {
  it('strips on the demo', () => {
    expect(demoLinkInput({ t: 'www.x.cz' }, DEMO)).toEqual({ t: '' })
  })

  it('returns the same value on a preview and on a demo flag with ADMIN_PASSWORD', () => {
    const input = { t: 'www.x.cz' }
    expect(demoLinkInput(input, { TASKMASTER_ENV: 'preview' })).toBe(input)
    expect(demoLinkInput(input, { ...DEMO, ADMIN_PASSWORD: 'x' })).toBe(input)
    expect(demoLinkInput(input, {})).toBe(input)
  })
})
