import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { DEVICE_KINDS } from '~/server/db/schema'

// The labels are typed exhaustively in strings.ts; this pins it at run time too, here where
// the schema may be imported (screens can't).
describe('passkey device labels', () => {
  it.each(DEVICE_KINDS)('%s has a label', (kind) => {
    expect(cs.passkeys.device[kind].trim()).not.toBe('')
  })
})
