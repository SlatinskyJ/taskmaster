// The person form's text fields, in order (#286). Return in one moves to the next; Return in the
// last one saves. The role picker between them is no text field: Return skips it (the role
// keeps its value, Hráč by default) and the admin taps it when it should change.

export type PersonField = 'displayName' | 'username' | 'password'

/** The text fields each sheet shows, in order: the form renders exactly these. */
export const PERSON_FIELDS: Record<'add' | 'edit', readonly PersonField[]> = {
  add: ['displayName', 'username', 'password'],
  // Editing changes the name only; username and password have their own ways.
  edit: ['displayName'],
}

/** The field Return moves to, or null when Return saves. */
export function nextPersonField(mode: 'add' | 'edit', field: PersonField): PersonField | null {
  const fields = PERSON_FIELDS[mode]
  return fields[fields.indexOf(field) + 1] ?? null
}

/** What the phone keyboard's Return key says on this field. */
export function personEnterKeyHint(mode: 'add' | 'edit', field: PersonField): 'next' | 'done' {
  return nextPersonField(mode, field) === null ? 'done' : 'next'
}
