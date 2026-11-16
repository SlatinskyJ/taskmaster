import { createFileRoute } from '@tanstack/react-router'

// Liveness probe for the container HEALTHCHECK and preview deploys. No auth, no data.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } }),
    },
  },
})
