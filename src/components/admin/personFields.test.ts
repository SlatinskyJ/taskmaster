import { describe, expect, it } from 'vitest'
import { nextPersonField, personEnterKeyHint } from './personFields'

describe('person form Return key (#286)', () => {
  it('add: name → login → password, then Return saves', () => {
    expect(nextPersonField('add', 'displayName')).toBe('username')
    expect(nextPersonField('add', 'username')).toBe('password')
    expect(nextPersonField('add', 'password')).toBeNull()
  })

  it('add: next, next, done', () => {
    expect(personEnterKeyHint('add', 'displayName')).toBe('next')
    expect(personEnterKeyHint('add', 'username')).toBe('next')
    expect(personEnterKeyHint('add', 'password')).toBe('done')
  })

  it('edit: the name is the only field, so Return saves', () => {
    expect(nextPersonField('edit', 'displayName')).toBeNull()
    expect(personEnterKeyHint('edit', 'displayName')).toBe('done')
  })
})
