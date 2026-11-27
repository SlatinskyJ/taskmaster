import { HeadContent, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { guardedReentryUrl } from '~/lib/frame'
import { trackVisualViewport } from '~/lib/visualViewport'
import { Toaster } from '~/components/ui/sonner'
import { themeBootScript } from '~/lib/theme'
import { pwaLinks, pwaMeta, themeColorMeta } from '~/pwa/head'
import { installBootScript } from '~/pwa/install'
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
  useEffect(() => {
    // A viewer frame loaded without its token (dev and previews): load it again with it, at
    // most once per address in a few seconds, so a redirect that drops it can't loop.
    const url = guardedReentryUrl(window, sessionStorageOrUndefined(), Date.now())
    if (url) location.replace(url)
  }, [])
  return (
    // The boot script sets data-theme and the theme-color metas before hydration, so React
    // must not fight either. The metas come first: the script writes to them.
    <html lang="cs" suppressHydrationWarning>
      <head>
        {themeColorMeta.map((meta) => (
          <meta key={meta.media} {...meta} suppressHydrationWarning />
        ))}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* beforeinstallprompt can fire before hydration; keep it for Profil (#302). */}
        <script dangerouslySetInnerHTML={{ __html: installBootScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}

/** `window.sessionStorage`, or undefined where reading it throws (blocked storage). */
function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}
