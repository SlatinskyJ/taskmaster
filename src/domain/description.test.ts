import { describe, expect, it } from 'vitest'
import {
  answerDescription,
  changeDescription,
  normaliseDescription,
  taskDescriptionRule,
  templateDescriptionRule,
  waitingChangeAfter,
} from './description'
import type { DescriptionRule } from './description'
import type { Item } from './lifecycle'
import type { Person } from './parties'
import { fail, ok } from './result'

const TATA: Person = { id: 2, role: 'giver', active: true }
const OLD_GIVER: Person = { id: 6, role: 'giver', active: false }
const STARSI: Person = { id: 3, role: 'taker', active: true }
const MLADSI: Person = { id: 4, role: 'taker', active: true }
const people = [TATA, OLD_GIVER, STARSI, MLADSI]

const base = { origin: 'one_time', approvalRequired: true, deadline: null } as const
const completion = {
  completedBy: 3,
  completedAt: new Date(0),
  earner: 3,
  reservation: null,
}
const proposed: Item = { ...base, status: 'proposed' }
const open: Item = { ...base, status: 'open' }
const reserved: Item = { ...base, status: 'reserved', reservation: { takerId: 7, via: 'tap' } }
const done: Item = { ...base, status: 'done_unconfirmed', completion }
const confirmed: Item = { ...base, status: 'confirmed', completion }
const cancelled: Item = { ...base, status: 'cancelled' }
const instance: Item = { ...base, origin: 'on_demand', status: 'open' }

const DIRECT: DescriptionRule = { kind: 'direct' }
const ANY: DescriptionRule = { kind: 'any_taker' }
const ONLY_STARSI: DescriptionRule = { kind: 'taker', takerId: 3 }

describe('normaliseDescription', () => {
  it('turns CRLF and CR into LF and trims the whole text', () => {
    expect(normaliseDescription('  a\r\nb\r ')).toEqual(ok('a\nb'))
  })
  it('empty or blank is no description', () => {
    expect(normaliseDescription('')).toEqual(ok(null))
    expect(normaliseDescription('   ')).toEqual(ok(null))
    expect(normaliseDescription('\u0000'.repeat(5))).toEqual(ok(null))
  })
  it('counts the length after normalising: 1000 is fine, 1001 is too long', () => {
    expect(normaliseDescription('a'.repeat(1000) + '\r\n')).toEqual(ok('a'.repeat(1000)))
    expect(normaliseDescription('a'.repeat(1000) + '\u0000'.repeat(5))).toEqual(
      ok('a'.repeat(1000)),
    )
    expect(normaliseDescription('a'.repeat(1001))).toEqual(fail('description_too_long'))
  })
  it('removes control characters except LF and TAB, and the bidi controls', () => {
    expect(normaliseDescription('a\u0000b\u0007\tc\u007f')).toEqual(ok('ab\tc'))
    expect(normaliseDescription('a‮b⁦c')).toEqual(ok('abc'))
    expect(normaliseDescription('x\u0008\u000B\u001B\u001F\u007F‪⁩y')).toEqual(ok('xy'))
    expect(normaliseDescription('a b c⁰')).toEqual(ok('a b c⁰'))
  })
})

describe('taskDescriptionRule', () => {
  it('proposed → direct; open → any taker; reserved → its taker', () => {
    expect(taskDescriptionRule(proposed)).toEqual(ok(DIRECT))
    expect(taskDescriptionRule(open)).toEqual(ok(ANY))
    expect(taskDescriptionRule(reserved)).toEqual(ok({ kind: 'taker', takerId: 7 }))
  })
  it('frozen once done, confirmed or cancelled', () => {
    for (const item of [done, confirmed, cancelled]) {
      expect(taskDescriptionRule(item)).toEqual(fail('description_frozen'))
    }
  })
  it('an instance is not changeable', () => {
    expect(taskDescriptionRule(instance)).toEqual(fail('not_changeable'))
  })
})

describe('templateDescriptionRule', () => {
  it('proposed → direct; agreed → any taker', () => {
    expect(templateDescriptionRule('proposed')).toEqual(DIRECT)
    expect(templateDescriptionRule('agreed')).toEqual(ANY)
  })
})

describe('changeDescription', () => {
  it('only an active giver changes it', () => {
    expect(changeDescription(DIRECT, 'x', undefined, people, 3, 'y')).toEqual(fail('not_a_giver'))
    expect(changeDescription(DIRECT, 'x', undefined, people, 6, 'y')).toEqual(fail('not_a_giver'))
  })
  it('direct applies; any taker or one taker waits', () => {
    expect(changeDescription(DIRECT, 'x', undefined, people, 2, 'y')).toEqual(ok('apply'))
    expect(changeDescription(ANY, 'x', undefined, people, 2, 'y')).toEqual(ok('wait'))
    expect(changeDescription(ONLY_STARSI, 'x', undefined, people, 2, 'y')).toEqual(ok('wait'))
  })
  it('the same text is refused; back to the text in force while a change waits withdraws it', () => {
    expect(changeDescription(ANY, 'x', undefined, people, 2, 'x')).toEqual(fail('same_description'))
    expect(changeDescription(ANY, 'x', 'y', people, 2, 'x')).toEqual(ok('withdraw'))
    expect(changeDescription(ANY, 'x', 'y', people, 2, 'y')).toEqual(fail('same_description'))
  })
  it('removal: null is a text like any other', () => {
    expect(changeDescription(DIRECT, 'x', undefined, people, 2, null)).toEqual(ok('apply'))
    expect(changeDescription(ANY, 'x', undefined, people, 2, null)).toEqual(ok('wait'))
    expect(changeDescription(ANY, null, undefined, people, 2, null)).toEqual(
      fail('same_description'),
    )
    expect(changeDescription(ANY, 'x', null, people, 2, null)).toEqual(fail('same_description'))
    expect(changeDescription(ANY, 'x', null, people, 2, 'x')).toEqual(ok('withdraw'))
  })
})

describe('answerDescription', () => {
  it('a giver never answers', () => {
    expect(answerDescription(ANY, people, 2)).toEqual(fail('not_a_taker'))
  })
  it('any taker on an open one; only the reserver on a reserved one', () => {
    expect(answerDescription(ANY, people, 4)).toEqual(ok(true))
    expect(answerDescription(ONLY_STARSI, people, 4)).toEqual(fail('not_involved'))
    expect(answerDescription(ONLY_STARSI, people, 3)).toEqual(ok(true))
  })
  it('nothing waits on a proposed one', () => {
    expect(answerDescription(DIRECT, people, 3)).toEqual(fail('not_involved'))
  })
})

describe('waitingChangeAfter', () => {
  it('keeps on open and reserved, applies on proposed, discards once done or cancelled', () => {
    expect(waitingChangeAfter(open)).toBe('keep')
    expect(waitingChangeAfter(reserved)).toBe('keep')
    expect(waitingChangeAfter(proposed)).toBe('apply')
    for (const item of [done, confirmed, cancelled])
      expect(waitingChangeAfter(item)).toBe('discard')
  })
})
