/**
 * Dev-only pages (the UI showcase at /dev/ui) exist in `pnpm dev` and on PR previews,
 * never in production. Same flag as the demo seed (src/server/demo).
 */
export function devPagesAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== 'production' || env.TASKMASTER_ENV === 'preview'
}
