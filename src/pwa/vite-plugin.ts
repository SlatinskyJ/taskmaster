// Builds the service worker into the client output as /sw.js (spec §11, PWA [call]).
// No Workbox: the worker is src/pwa/sw.ts, bundled by a small nested Vite build into one
// classic script (TanStack Start allows only one client entry), then given this build's data
// (version, precache list, offline page). Imported by vite.config.ts: relative imports only.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build, type Plugin } from 'vite'
import { cs } from '../lib/strings'
import { offlinePage } from './offline'
import { SHELL_FILES } from './policy'

export const SW_FILE = 'sw.js'
export const PLACEHOLDER = '__TM_SW_BUILD__'

export interface ShellBuild {
  version: string
  precache: string[]
}

/**
 * The precache list and the build version. The version is a hash of the hashed asset names and
 * the shell files' contents, so any client change (or a new icon) gives a new cache name.
 * Only scripts and styles are precached: fonts come in many subsets (Cyrillic, Hebrew, …),
 * so they are cached when the page first asks for them.
 */
export function shellBuild(
  bundleFiles: readonly string[],
  readShellFile: (path: string) => Buffer | string,
): ShellBuild {
  const assets = bundleFiles
    .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
    .map((file) => `/${file}`)
    .sort()
  const hash = createHash('sha256')
  for (const asset of assets) hash.update(asset).update('\0')
  for (const path of SHELL_FILES) hash.update(path).update('\0').update(readShellFile(path))
  const code = assets.filter((asset) => asset.endsWith('.js') || asset.endsWith('.css'))
  return { version: hash.digest('hex').slice(0, 16), precache: [...SHELL_FILES, ...code] }
}

/** Bundles src/pwa/sw.ts (and ./policy) into one minified IIFE, with the placeholder kept. */
export async function bundleWorker(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    build: {
      write: false,
      minify: true,
      emptyOutDir: false,
      lib: {
        entry: join(import.meta.dirname, 'sw.ts'),
        formats: ['iife'],
        name: 'tmServiceWorker',
      },
    },
  })
  const results = Array.isArray(output) ? output : [output]
  const chunk = results.flatMap((result) => ('output' in result ? result.output : []))[0]
  if (chunk?.type !== 'chunk') throw new Error('[pwa] the service worker bundle is empty')
  if (!chunk.code.includes(PLACEHOLDER)) throw new Error(`[pwa] ${PLACEHOLDER} not found`)
  return chunk.code
}

export function serviceWorkerPlugin(): Plugin {
  let publicDir = ''
  return {
    name: 'taskmaster:service-worker',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    configResolved(config) {
      publicDir = config.publicDir
    },
    async generateBundle(_options, bundle) {
      const worker = await bundleWorker()
      const files = Object.keys(bundle)
      const shell = shellBuild(files, (path) => readFileSync(join(publicDir, path)))
      const data = JSON.stringify({
        ...shell,
        offlineHtml: offlinePage(cs.app.name, cs.offline),
      })
      // A function, so `$` sequences in the data are not read as replacement patterns.
      const source = worker.replaceAll(PLACEHOLDER, () => data)
      this.emitFile({ type: 'asset', fileName: SW_FILE, source })
    },
  }
}
