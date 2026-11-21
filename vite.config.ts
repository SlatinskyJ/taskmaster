import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { serviceWorkerPlugin, SW_FILE } from './src/pwa/vite-plugin'

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({ srcDirectory: 'src' }),
    viteReact(),
    serviceWorkerPlugin(),
    nitro({
      preset: 'node-server',
      plugins: ['./src/server/plugins/database.ts'],
      // Not bundled: bundling hoists @peculiar/x509 above the library's own
      // `import 'reflect-metadata'`, and the passkey screens then fail to load (#29).
      traceDeps: ['@simplewebauthn/server'],
      // Browsers and the Cloudflare edge must always revalidate the worker script, or clients
      // keep an old sw.js (and its precache list of deleted assets) after a deploy.
      routeRules: { [`/${SW_FILE}`]: { headers: { 'cache-control': 'no-cache' } } },
    }),
  ],
})
