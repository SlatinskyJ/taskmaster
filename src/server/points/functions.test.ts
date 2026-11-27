import { describe, expect, it } from 'vitest'
import { family, T0 } from '~/server/tasks/testing'
import { pointsRead } from './functions'

// Points' live topics (#299): a giver every taker shown, a taker only himself.

const as = (id: number, role: 'giver' | 'taker') => ({
  id,
  username: role,
  displayName: role,
  role,
})

describe('topics', () => {
  it("a giver: people and every taker's points", () => {
    const f = family()
    const tata = as(f.tata, 'giver')
    const data = pointsRead.read(f.db, tata, undefined, T0)
    expect(pointsRead.topics(tata, data, f.db)).toEqual([
      'people',
      `points:${String(f.starsi)}`,
      `points:${String(f.mladsi)}`,
    ])
  })

  it("a taker: his own points only, never his brother's", () => {
    const f = family()
    const starsi = as(f.starsi, 'taker')
    const data = pointsRead.read(f.db, starsi, undefined, T0)
    expect(pointsRead.topics(starsi, data, f.db)).toEqual([`points:${String(f.starsi)}`])
    expect(pointsRead.topics(starsi, { ...data, takers: [] }, f.db)).toEqual([
      `points:${String(f.starsi)}`,
    ])
  })
})
