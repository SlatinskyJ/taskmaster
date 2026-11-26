import { createFileRoute } from '@tanstack/react-router'
import { liveStreamResponse } from '~/server/live/functions'

// Live change notices (#299): the Server-Sent Events stream. Signed-in users only, behind the
// `liveChanges` switch; src/server/live/README.md has the request and the wire format.
export const Route = createFileRoute('/api/live')({
  server: {
    handlers: {
      GET: ({ request }) => liveStreamResponse(request),
    },
  },
})
