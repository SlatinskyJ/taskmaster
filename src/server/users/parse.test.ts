import { describe, expect, it } from 'vitest'
import { parseNewPerson, parsePersonEdit, parseReset } from './parse'

describe('people server function inputs', () => {
  it('parsePersonEdit drops anything but name and role', () => {
    expect(
      parsePersonEdit({
        userId: 3,
        displayName: 'X',
        role: 'taker',
        active: false,
        passwordHash: 'h',
      }),
    ).toEqual({ userId: 3, displayName: 'X', role: 'taker' })
    expect(parsePersonEdit({ userId: 3, role: 'giver' })).toEqual({ userId: 3, role: 'giver' })
  })

  it('parseReset keeps the target user', () => {
    expect(parseReset({ userId: 5, password: 'abcdefgh' })).toEqual({
      userId: 5,
      password: 'abcdefgh',
    })
  })

  it('parseNewPerson passes the four fields through', () => {
    const input = { username: 'kuba', displayName: 'Kuba', role: 'taker', password: 'zahrada12' }
    expect(parseNewPerson({ ...input, active: false })).toEqual(input)
  })

  it('bad shapes throw', () => {
    expect(() => parseNewPerson(null)).toThrow('Invalid input')
    expect(() => parseNewPerson({ username: 1 })).toThrow('Invalid input')
    expect(() => parseReset({ userId: '5', password: 'x' })).toThrow('Invalid input')
    expect(() => parsePersonEdit({ userId: 1.5 })).toThrow('Invalid input')
    expect(() => parsePersonEdit({ userId: 1, role: 3 })).toThrow('Invalid input')
  })
})
