import { createRouter } from '@tanstack/react-router'
import { NotFound } from './components/NotFound'
import { RouteError } from './components/RouteError'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
