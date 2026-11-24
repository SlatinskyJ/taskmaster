import { HeadContent, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { trackVisualViewport } from '~/lib/visualViewport'
import { Toaster } from '~/components/ui/sonner'
import { themeBootScript } from '~/lib/theme'
import { pwaLinks, pwaMeta, themeColorMeta } from '~/pwa/head'
import { registerServiceWorker } from '~/pwa/register'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Taskmaster' },
      ...pwaMeta,
    ],
    links: [{ rel: 'stylesheet', href: appCss }, ...pwaLinks],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    registerServiceWorker(router)
  }, [router])
  useEffect(() => trackVisualViewport(window), [])
  return (
    // data-theme is set before hydration by the boot script, so React must not fight it.
    <html lang="cs" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
        {themeColorMeta.map((meta) => (
          <meta key={meta.media} {...meta} />
        ))}
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
