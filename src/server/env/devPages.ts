import { demoDataAllowed } from './demo'

/**
 * Dev-only pages (the UI showcase at /dev/ui) exist in `pnpm dev`, on PR previews and on the
 * public demo, never in production. Same flag as the demo seed (src/server/demo).
 */
export function devPagesAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== 'production' || demoDataAllowed(env)
}
