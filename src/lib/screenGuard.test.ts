import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { ROLES } from '~/domain/parties'
import { landingPath } from './landing'
import { APP_PATHS, canSee } from './nav'
import { guardDisputeReader, guardScreen } from './screenGuard'

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

describe('guardDisputeReader (#222)', () => {
  const PAGES = ['/ukol/$taskId', '/sablona/$templateId'] as const
  it.each(PAGES)('the admin reads %s only while disputes is on', (path) => {
    expect(
      outcome(() => {
        guardDisputeReader('admin', path, true)
      }),
    ).toBe('pass')
    expect(
      outcome(() => {
        guardDisputeReader('admin', path, false)
      }),
    ).toBe(`redirect ${landingPath('admin')}`)
  })
  it.each(PAGES)('a giver or taker on %s is unchanged by the switch', (path) => {
    for (const role of ['giver', 'taker'] as const) {
      for (const on of [true, false]) {
        expect(
          outcome(() => {
            guardDisputeReader(role, path, on)
          }),
        ).toBe('pass')
      }
    }
  })
})
