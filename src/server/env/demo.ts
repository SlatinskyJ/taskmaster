// The public demo (docs/superpowers/specs/2026-11-27-demo-environment-design.md): one server
// with demo data that anyone may try. `TASKMASTER_ENV=demo` turns it on; every demo branch in
// the server asks `isDemo`. A real deploy sets ADMIN_PASSWORD, so a demo flag leaked into one
// turns nothing on.

const adminPasswordSet = (env: NodeJS.ProcessEnv) => (env.ADMIN_PASSWORD ?? '') !== ''

/** The public demo: `TASKMASTER_ENV=demo` exactly, and no ADMIN_PASSWORD. */
export function isDemo(env: NodeJS.ProcessEnv): boolean {
  return env.TASKMASTER_ENV === 'demo' && !adminPasswordSet(env)
}

/** Demo data and dev pages: on a PR preview and on the demo. */
export function demoDataAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.TASKMASTER_ENV === 'preview' || isDemo(env)
}

/**
 * The demo's per-IP caps must see the visitor, not the reverse proxy, so the demo refuses to
 * boot without TRUST_PROXY=1 (like a bad passkey config).
 */
export function assertDemoProxy(env: NodeJS.ProcessEnv): void {
  if (isDemo(env) && env.TRUST_PROXY !== '1') {
    throw new Error('TASKMASTER_ENV=demo needs TRUST_PROXY=1: the per-IP caps must see the visitor')
  }
}
