import { createServerFn } from '@tanstack/react-start'

/**
 * Dev-only pages (the UI showcase at /dev/ui) exist in `pnpm dev` and on PR previews,
 * never in production. Same rule as TEST_USERS (src/server/users/bootstrap.ts).
 */
export function devPagesAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== 'production' || env.TASKMASTER_ENV === 'preview'
}

export const getDevPagesAllowed = createServerFn({ method: 'GET' }).handler(() =>
  devPagesAllowed(process.env),
)
