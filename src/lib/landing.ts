import type { Role } from '~/domain/parties'

/** Where a role lands after login (UI doc §6): admin on Správa, everyone else on Domů. */
export function landingPath(role: Role): '/' | '/sprava' {
  return role === 'admin' ? '/sprava' : '/'
}
