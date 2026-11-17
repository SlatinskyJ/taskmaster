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
      // Browsers and the Cloudflare edge must always revalidate the worker script, or clients
      // keep an old sw.js (and its precache list of deleted assets) after a deploy.
      routeRules: { [`/${SW_FILE}`]: { headers: { 'cache-control': 'no-cache' } } },
    }),
  ],
})
