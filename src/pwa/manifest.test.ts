import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_COLORS, pwaLinks, themeColorMeta } from './head'
import { SHELL_FILES } from './policy'

// The installable bits in public/: the web manifest and its icons (spec §11, PWA [call]).

const publicFile = (path: string) => new URL(`../../public${path}`, import.meta.url)

interface Icon {
  src: string
  sizes: string
  type: string
  purpose: string
}
const manifest = JSON.parse(readFileSync(publicFile('/manifest.webmanifest'), 'utf8')) as {
  name: string
  short_name: string
  lang: string
  display: string
  start_url: string
  scope: string
  background_color: string
  theme_color: string
  icons: Icon[]
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const png = readFileSync(publicFile(path))
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

describe('web manifest', () => {
  it('installs as a standalone Czech app at the root', () => {
    expect(manifest).toMatchObject({
      name: 'Taskmaster',
      short_name: 'Taskmaster',
      lang: 'cs',
      display: 'standalone',
      start_url: '/',
      scope: '/',
    })
  })

  it('uses the Pastelky page background (UI doc §2.1)', () => {
    const css = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8')
    const bg = /:root \{[^}]*--bg:\s*(#[0-9a-f]{6});/i.exec(css)?.[1]
    expect(bg?.toLowerCase()).toBe(THEME_COLORS.light.toLowerCase())
    const darkBg = /:root:not\(\[data-theme='light'\]\) \{[^}]*--bg:\s*(#[0-9a-f]{6});/i.exec(css)
    expect(darkBg?.[1]?.toLowerCase()).toBe(THEME_COLORS.dark.toLowerCase())
    expect(themeColorMeta.map((meta) => [meta.media, meta.content])).toEqual([
      ['(prefers-color-scheme: light)', THEME_COLORS.light],
      ['(prefers-color-scheme: dark)', THEME_COLORS.dark],
    ])
    expect(manifest.background_color).toBe(THEME_COLORS.light)
    expect(manifest.theme_color).toBe(THEME_COLORS.light)
  })

  it('has 192 and 512 icons plus a maskable one, each the size it claims', () => {
    const purposes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)
    expect(purposes).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    )
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(pngSize(icon.src).join('x')).toBe(icon.sizes)
    }
  })

  it('has a 180 px apple-touch-icon for iOS', () => {
    const touch = pwaLinks.find((link) => link.rel === 'apple-touch-icon')
    expect(touch?.href).toBeDefined()
    expect(pngSize(touch?.href ?? '')).toEqual([180, 180])
  })

  it('lists every icon and the manifest among the cached shell files', () => {
    const linked = pwaLinks.filter((link) => link.rel !== 'stylesheet').map((link) => link.href)
    const files = [...linked, ...manifest.icons.map((icon) => icon.src)]
    expect(SHELL_FILES).toEqual(expect.arrayContaining(files))
    for (const path of SHELL_FILES) expect(() => readFileSync(publicFile(path))).not.toThrow()
  })
})
