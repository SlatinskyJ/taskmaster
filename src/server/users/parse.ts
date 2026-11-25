import type { UserRole } from '~/server/db/schema'
import type { AddPersonInput } from './admin'

// Inputs of the people server functions (./functions), checked for shape only: values (role,
// name, login name, password length) are checked by ./admin and ./manage. Unknown keys are
// dropped, so `active` or a hash can never ride along.

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  return data as Record<string, unknown>
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid input')
  return value
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid input')
  return value
}

/** A role string; `manage.ts` refuses one that isn't a real role (`invalid_role`). */
const role = (value: unknown): UserRole => str(value) as UserRole

export function parseNewPerson(data: unknown): AddPersonInput {
  const d = record(data)
  return {
    username: str(d.username),
    displayName: str(d.displayName),
    role: role(d.role),
    password: str(d.password),
  }
}

export interface PersonEdit {
  userId: number
  displayName?: string
  role?: UserRole
}

export function parsePersonEdit(data: unknown): PersonEdit {
  const d = record(data)
  const edit: PersonEdit = { userId: int(d.userId) }
  if (d.displayName !== undefined) edit.displayName = str(d.displayName)
  if (d.role !== undefined) edit.role = role(d.role)
  return edit
}

export function parseReset(data: unknown): { userId: number; password: string } {
  const d = record(data)
  return { userId: int(d.userId), password: str(d.password) }
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid input')
  return value
}

export interface ChangePasswordData {
  current: string
  next: string
  logOutOthers: boolean
}

/** Profil → Změnit heslo (#210). Lengths are checked by ./changePassword. */
export function parseChangePassword(data: unknown): ChangePasswordData {
  const d = record(data)
  return { current: str(d.current), next: str(d.next), logOutOthers: bool(d.logOutOthers) }
}
