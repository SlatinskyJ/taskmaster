import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_PATHS } from '~/lib/nav'

// Every screen behind login (src/routes/_app/) gates itself with `guardScreen(role, '<its own
// path>')`, and every path in `APP_PATHS` has a screen. A copied route with the wrong path, or a
// new screen without a gate, fails here. The role matrix itself is tested in src/lib/nav.test.ts.

const DIR = join(import.meta.dirname, '..', 'src', 'routes', '_app')

function routeFiles(dir: string, prefix = ''): { file: string; path: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = entry.name
    if (entry.isDirectory()) return routeFiles(join(dir, name), `${prefix}/${name}`)
    if (!name.endsWith('.tsx') || name.endsWith('.test.tsx')) return []
    const stem = name.replace(/\.tsx$/, '')
    const path = stem === 'index' ? prefix || '/' : `${prefix}/${stem}`
    return [{ file: join(dir, name), path }]
  })
}

const screens = routeFiles(DIR)

describe('screen gates', () => {
  it.each(screens)('$path calls guardScreen with its own path', ({ file, path }) => {
    const text = readFileSync(file, 'utf8')
    const calls = [...text.matchAll(/guardScreen\(\s*context\.user\.role,\s*'([^']*)'\s*\)/g)]
    expect(calls.map((m) => m[1])).toEqual([path])
  })

  it('every app path has a screen, and every screen is an app path', () => {
    expect(screens.map((s) => s.path).sort()).toEqual([...APP_PATHS].sort())
  })
})
