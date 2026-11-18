import { cs } from './strings'
import { MAX_DISPLAY_NAME, MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from './userLimits'

/** Czech message for a people action the server refused (codes from src/server/users). */
export function userErrorMessage(error: string): string {
  const e = cs.admin.errors
  switch (error) {
    case 'invalid_username':
      return e.invalidUsername
    case 'username_taken':
      return e.usernameTaken
    case 'invalid_name':
      return e.invalidName(MAX_DISPLAY_NAME)
    case 'invalid_role':
      return e.invalidRole
    case 'invalid_password':
      return e.invalidPassword(MIN_USER_PASSWORD, MAX_PASSWORD_LENGTH)
    case 'last_admin':
      return e.lastAdmin
    case 'not_found':
      return e.notFound
    case 'not_admin':
      return e.notAdmin
    default:
      return cs.login.failed
  }
}
