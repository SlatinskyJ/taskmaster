import { describe, expect, it } from 'vitest'
import { fail, ok } from '~/domain/result'
import type { TaskRow } from '~/server/db/schema'
import { instanceResult } from './functions'
import { parseSelfLog } from './parse'

// What the instance server functions take and give back (#38). Roles: tests/server-fn-guards.

describe('parseSelfLog', () => {
  it('takes a template id and a score', () => {
    expect(parseSelfLog({ templateId: 3, score: 4 })).toEqual({ templateId: 3, score: 4 })
  })
  it.each([
    null,
    {},
    { templateId: 3 },
    { templateId: '3', score: 4 },
    { templateId: 3, score: 1.5 },
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
