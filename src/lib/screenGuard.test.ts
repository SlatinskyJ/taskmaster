import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { ROLES } from '~/domain/parties'
import { landingPath } from './landing'
import { APP_PATHS, canSee } from './nav'
import { guardScreen } from './screenGuard'

function outcome(run: () => void): string {
  try {
    run()
    return 'pass'
  } catch (e) {
    if (isRedirect(e)) return `redirect ${String(e.options.to)}`
    throw e
  }
}

describe('guardScreen', () => {
  for (const role of ROLES) {
    it.each(APP_PATHS)(`${role} on %s: passes if allowed, else goes to its landing`, (path) => {
      const expected = canSee(role, path) ? 'pass' : `redirect ${landingPath(role)}`
      expect(
        outcome(() => {
          guardScreen(role, path)
        }),
      ).toBe(expected)
    })
  }
})
