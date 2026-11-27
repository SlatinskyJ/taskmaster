import { describe, expect, it } from 'vitest'
import { family } from '~/server/tasks/testing'
import { usersRead } from './functions'

// Lidé on Správa (#299): the list of people subscribes to people.

describe('topics', () => {
  it('Lidé: people', () => {
    const f = family()
    const admin = { id: f.admin, username: 'admin', displayName: 'Admin', role: 'admin' as const }
    const data = usersRead.read(f.db, admin, undefined, new Date())
    expect(data.length).toBe(4)
    expect(usersRead.topics(admin, data, f.db)).toEqual(['people'])
  })
})
