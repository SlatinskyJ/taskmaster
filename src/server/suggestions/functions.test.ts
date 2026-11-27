import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { family, T0 } from '~/server/tasks/testing'
import { adminSuggestionsRead, mySuggestionsRead } from './functions'

// Live topics of the suggestion lists (#299): one's own is a slice, the admin's is all of them.

const as = (id: number, role: 'giver' | 'taker' | 'admin') => ({
  id,
  username: role,
  displayName: role,
  role,
})

function setup(on: boolean) {
  const f = family()
  f.db.run(sql`UPDATE feature_flags SET enabled = ${on ? 1 : 0} WHERE key = 'suggestions'`)
  return f
}

describe('topics', () => {
  it('Profil: suggestions:by:<self> for every role; never the broad topic', () => {
    const f = setup(true)
    for (const v of [as(f.tata, 'giver'), as(f.starsi, 'taker'), as(f.admin, 'admin')]) {
      const data = mySuggestionsRead.read(f.db, v, undefined, T0)
      expect(mySuggestionsRead.topics(v, data, f.db)).toEqual([`suggestions:by:${String(v.id)}`])
    }
  })

  it("Správa: the admin's list is suggestions", () => {
    const f = setup(true)
    const admin = as(f.admin, 'admin')
    const data = adminSuggestionsRead.read(f.db, admin, undefined, T0)
    expect(adminSuggestionsRead.topics(admin, data, f.db)).toEqual(['suggestions'])
  })

  it('suggestions off: no topics on either', () => {
    const f = setup(false)
    const admin = as(f.admin, 'admin')
    const mine = mySuggestionsRead.read(f.db, admin, undefined, T0)
    const all = adminSuggestionsRead.read(f.db, admin, undefined, T0)
    expect(mine).toEqual({ error: 'feature_off' })
    expect(mySuggestionsRead.topics(admin, mine, f.db)).toEqual([])
    expect(adminSuggestionsRead.topics(admin, all, f.db)).toEqual([])
  })
})
