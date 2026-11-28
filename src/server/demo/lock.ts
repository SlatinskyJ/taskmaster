import { createMiddleware } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'
import { DemoLockedError } from '~/server/auth/guards'
import { isDemo } from '~/server/env/demo'

// The public demo's lock (docs/superpowers/specs/2026-11-27-demo-environment-design.md): a
// visitor may try everything except what would take the demo away from the next visitor
// (passwords, people, launch switches). Each locked server function lists `demoLock` after its
// role guard, so an anonymous caller still gets the usual 401. tests/server-fn-guards.test.ts
// pins the list below against the code. Outside the demo it does nothing.

/**
 * The server functions that refuse on the demo. Their screens show the controls disabled on the
 * demo (src/routes/_app/sprava.tsx, ProfilePassword): keep both in step.
 */
export const DEMO_LOCKED_FNS: readonly string[] = [
  'createUserFn',
  'updateUserFn',
  'resetPasswordFn',
  'changePasswordFn',
  'setSwitchFn',
]

export const demoLock = createMiddleware({ type: 'function' }).server(({ next }) => {
  if (isDemo(process.env)) {
    setResponseStatus(403)
    throw new DemoLockedError()
  }
  return next()
})
