import { describe, expect, it } from 'vitest'
import { cs } from './strings'
import { userErrorMessage } from './userErrors'

describe('people error messages', () => {
  it.each([
    ['invalid_username', cs.admin.errors.invalidUsername],
    ['username_taken', cs.admin.errors.usernameTaken],
    ['invalid_name', cs.admin.errors.invalidName(40)],
    ['invalid_role', cs.admin.errors.invalidRole],
    ['invalid_password', cs.admin.errors.invalidPassword(8, 256)],
    ['last_admin', cs.admin.errors.lastAdmin],
    ['not_found', cs.admin.errors.notFound],
    ['not_admin', cs.admin.errors.notAdmin],
    // The server hashes, so a bad hash never comes from the form: generic message.
    ['invalid_hash', cs.login.failed],
    ['something_else', cs.login.failed],
  ])('%s', (code, message) => {
    expect(userErrorMessage(code)).toBe(message)
  })
})
