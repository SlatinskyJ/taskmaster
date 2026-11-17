import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_SERVER_FNS } from '~/server/auth/guards'

// Every server function is reachable by anyone on the internet, so each one must say who may
// call it (#28). This scans the source: a server function either has a guard middleware
// (`requireUser`, `requireRole(...)`) or is listed in PUBLIC_SERVER_FNS. EXPECTED_ROLES pins
// who may call each guarded one, so a reviewer sees every change to it in this file.

/** Server function → roles allowed (`any` = every signed-in user). Add new ones here. */
const EXPECTED_ROLES: Record<string, string> = {
  listUsersFn: 'admin',
}

const SRC = join(import.meta.dirname, '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

interface ServerFn {
  name: string
  file: string
  /** `public`, `any`, a comma-separated role list, or `unguarded`. */
  access: string
}

function serverFns(): ServerFn[] {
  const found: ServerFn[] = []
  for (const file of sourceFiles(SRC)) {
    // Comment lines dropped: examples in comments are not server functions.
    const text = readFileSync(file, 'utf8').replace(/^\s*(\/\/|\/?\*).*$/gm, '')
    const rel = relative(SRC, file)
    // Each declaration runs from its `createServerFn(` to the next top-level statement.
    const decl = /^export const (\w+) = createServerFn\([\s\S]*?(?=^\S|(?![\s\S]))/gm
    const all = text.match(/createServerFn\(/g)?.length ?? 0
    let seen = 0
    for (const m of text.matchAll(decl)) {
      seen++
      const [body, name = ''] = m
      const middleware = /\.middleware\(\[\s*(requireUser|requireRole\(([^)]*)\))\s*\]\)/.exec(body)
      const roles = middleware?.[2]?.replace(/['"\s]/g, '')
      const access = (PUBLIC_SERVER_FNS as readonly string[]).includes(name)
        ? 'public'
        : middleware
          ? (roles ?? 'any')
          : 'unguarded'
      found.push({ name, file: rel, access })
    }
    // A server function not declared as `export const X = createServerFn(` can't be checked.
    if (seen !== all)
      found.push({
        name: '(not `export const X = createServerFn(`)',
        file: rel,
        access: 'unguarded',
      })
  }
  return found
}

describe('server function guards (#28)', () => {
  const fns = serverFns()

  it('every server function has a guard or is listed as public', () => {
    expect(fns.filter((f) => f.access === 'unguarded')).toEqual([])
  })

  it('every name in PUBLIC_SERVER_FNS is a real server function', () => {
    const names = fns.map((f) => f.name)
    for (const name of PUBLIC_SERVER_FNS) expect(names).toContain(name)
  })

  it('each guarded function allows exactly the roles pinned here', () => {
    const guarded = Object.fromEntries(
      fns.filter((f) => f.access !== 'public').map((f) => [f.name, f.access]),
    )
    expect(guarded).toEqual(EXPECTED_ROLES)
  })
})
