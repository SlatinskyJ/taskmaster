import { HeadContent, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { DemoMarker } from '~/components/shell/DemoMarker'
import { demoHeadMeta, loadIsDemo } from '~/lib/demo'
import { guardedReentryUrl } from '~/lib/frame'
import { trackVisualViewport } from '~/lib/visualViewport'
import { Toaster } from '~/components/ui/sonner'
import { themeBootScript } from '~/lib/theme'
import { pwaLinks, pwaMeta, themeColorMeta } from '~/pwa/head'
import { installBootScript } from '~/pwa/install'
import { registerServiceWorker } from '~/pwa/register'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  // Every route reads `context.demo`: the public demo's marker, login buttons and locks (#328).
  beforeLoad: async () => ({ demo: await loadIsDemo() }),
  head: ({ match }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Taskmaster' },
      ...pwaMeta,
      ...demoHeadMeta(match.context.demo),
    ],
    links: [{ rel: 'stylesheet', href: appCss }, ...pwaLinks],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const router = useRouter()
  const demo = Route.useRouteContext({ select: (c) => c.demo })
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
    // data-theme is set before hydration by the boot script, so React must not fight it.
    <html lang="cs" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* beforeinstallprompt can fire before hydration; keep it for Profil (#302). */}
        <script dangerouslySetInnerHTML={{ __html: installBootScript }} />
        <HeadContent />
        {themeColorMeta.map((meta) => (
          <meta key={meta.media} {...meta} />
        ))}
      </head>
      <body>
        <DemoMarker demo={demo} />
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
