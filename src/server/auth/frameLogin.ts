import type { Db } from '~/server/db'
import { DEMO_PASSWORD } from '~/lib/demoAccounts'
import { DEMO_USERS } from '~/server/demo'
import { devPagesAllowed } from '~/server/env/devPages'
import { login } from './login'
import type { LoginError } from './login'
import type { CurrentUser } from './sessions'

// The multi-user viewer's way in for a frame (dev and PR previews only): logs a demo user in
// with the known demo password, through the normal login (rate limit, inactive check, audit),
// and hands the token back instead of setting the cookie. The viewer keeps it in the frame.

export type FrameLoginResult =
  | { ok: true; token: string; user: CurrentUser }
  | { ok: false; error: 'not_available' | 'unknown_user' | LoginError }

export async function frameLogin(
  db: Db,
  env: NodeJS.ProcessEnv,
  username: string,
  ip: string,
  now: Date = new Date(),
): Promise<FrameLoginResult> {
  // ADMIN_PASSWORD is the demo seed's own lock (a real deploy sets it): if the preview flag ever
  // leaks into one, the known demo password must not open a session here either.
  if (!devPagesAllowed(env) || (env.ADMIN_PASSWORD ?? '') !== '') {
    return { ok: false, error: 'not_available' }
  }
  if (!DEMO_USERS.some((u) => u.username === username)) return { ok: false, error: 'unknown_user' }
  const result = await login(db, { username, password: DEMO_PASSWORD, ip }, now, env)
  if (!result.ok) return result
  return { ok: true, token: result.value.token, user: result.value.user }
}
