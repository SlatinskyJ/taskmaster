import { describe, expect, it } from 'vitest'
import { fail, ok } from '~/domain/result'
import type { TaskRow } from '~/server/db/schema'
import { family } from '~/server/tasks/testing'
import { instanceResult, loggableTemplatesRead } from './functions'
import { parseSelfLog } from './parse'

// What the instance server functions take and give back (#38). Roles: tests/server-fn-guards.

describe('parseSelfLog', () => {
  it('takes a template id, a score and when (default now)', () => {
    expect(parseSelfLog({ templateId: 3, score: 4 })).toEqual({
      templateId: 3,
      score: 4,
      when: 'now',
    })
    expect(parseSelfLog({ templateId: 3, score: 4, when: 'yesterday' })).toEqual({
      templateId: 3,
      score: 4,
      when: 'yesterday',
    })
  })
  it.each([
    null,
    {},
    { templateId: 3 },
    { templateId: '3', score: 4 },
    { templateId: 3, score: 1.5 },
    { templateId: 3, score: 4, when: 'last_week' },
    { templateId: 3, score: 4, when: 1 },
  ])('refuses %j', (input) => {
    expect(() => parseSelfLog(input)).toThrow('Invalid input')
  })
})

describe('instanceResult', () => {
  it('gives back only the id and score of the new row', () => {
    const row = { id: 7, score: 3, title: 'Vyndat myčku', earnerId: 4 } as TaskRow
    expect(instanceResult(ok(row))).toStrictEqual({ ok: true, id: 7, score: 3 })
  })
  it('passes a refusal through', () => {
    expect(instanceResult(fail('score_changed'))).toStrictEqual({
      ok: false,
      error: 'score_changed',
    })
  })
})

describe('topics (#299)', () => {
  it('Zapsat: templates and tasks (the tiles follow their copies)', () => {
    const f = family()
    const starsi = { id: f.starsi, username: 's', displayName: 'S', role: 'taker' as const }
    const data = loggableTemplatesRead.read(f.db, starsi, undefined, new Date())
    expect(loggableTemplatesRead.topics(starsi, data, f.db)).toEqual(['templates', 'tasks'])
  })
})
