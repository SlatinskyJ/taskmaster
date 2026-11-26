import { describe, expect, it } from 'vitest'
import { fail, ok } from './result'
import {
  charCount,
  cleanSuggestionText,
  ISSUE_BODY_MAX,
  ISSUE_FOOTER,
  issueBody,
  issueDraft,
  nextStatus,
  normaliseIssue,
  normaliseSuggestion,
  SUGGESTION_DESCRIPTION_MAX,
  SUGGESTION_TITLE_MAX,
} from './suggestions'
import type { SuggestionMove, SuggestionStatus } from './suggestions'

describe('limits', () => {
  it('are 120, 2000 and 4000 characters', () => {
    expect([SUGGESTION_TITLE_MAX, SUGGESTION_DESCRIPTION_MAX, ISSUE_BODY_MAX]).toEqual([
      120, 2000, 4000,
    ])
  })
})

describe('charCount', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(charCount('😀a')).toBe(2)
    expect(charCount('')).toBe(0)
  })
})

describe('cleanSuggestionText', () => {
  it('turns CR LF and lone CR into LF, drops hidden characters and trims', () => {
    expect(
      cleanSuggestionText(
        ' a\r\nb\rc\u0000\u0007\u007F\u202A\u2066\u200B\u200F\u2060\uFEFF ',
        false,
      ),
    ).toBe('a\nb\nc')
  })

  it('keeps tabs and line breaks in a multi-line text', () => {
    expect(cleanSuggestionText('a\tb\nc', false)).toBe('a\tb\nc')
  })

  it('makes a one-line text of line breaks and tabs', () => {
    expect(cleanSuggestionText('a\tb\r\nc', true)).toBe('a b c')
  })

  it('keeps ordinary letters, emoji and the characters next to the hidden ranges', () => {
    expect(cleanSuggestionText('Žluťoučký 😀 \u2010\u2061\u2029', false)).toBe(
      'Žluťoučký 😀 \u2010\u2061',
    )
  })
})

describe('normaliseSuggestion', () => {
  it('refuses a title of only spaces, line breaks or hidden characters', () => {
    expect(normaliseSuggestion({ title: '  \n\u200E\u200B\uFEFF\t ', description: '' })).toEqual(
      fail('title_empty'),
    )
  })

  it('removes hidden characters from title and description', () => {
    expect(normaliseSuggestion({ title: 'a\u200Bb', description: 'x\u202Ey' })).toEqual(
      ok({ title: 'ab', description: 'xy' }),
    )
  })

  it('makes the title one line and keeps the description lines', () => {
    expect(normaliseSuggestion({ title: 'a\nb', description: ' x\r\ny ' })).toEqual(
      ok({ title: 'a b', description: 'x\ny' }),
    )
  })

  it('takes a title of 120 characters counted as code points, refuses 121', () => {
    const title = '😀'.repeat(120)
    expect(title.length).toBe(240)
    expect(normaliseSuggestion({ title, description: '' })).toEqual(
      ok({ title, description: null }),
    )
    expect(normaliseSuggestion({ title: '😀'.repeat(121), description: '' })).toEqual(
      fail('title_too_long'),
    )
  })

  it('takes a description of 2000 characters, refuses 2001', () => {
    const description = '😀'.repeat(2000)
    expect(normaliseSuggestion({ title: 'T', description })).toEqual(
      ok({ title: 'T', description }),
    )
    expect(normaliseSuggestion({ title: 'T', description: 'a'.repeat(2001) })).toEqual(
      fail('description_too_long'),
    )
  })

  it('counts the limits after cleaning', () => {
    expect(normaliseSuggestion({ title: ` ${'a'.repeat(120)}\u200B `, description: '' })).toEqual(
      ok({ title: 'a'.repeat(120), description: null }),
    )
  })

  it('stores a blank description as null', () => {
    expect(normaliseSuggestion({ title: 'T', description: '   ' })).toEqual(
      ok({ title: 'T', description: null }),
    )
  })
})

describe('normaliseIssue', () => {
  it('takes a body of 4000 characters, refuses 4001, and an empty body', () => {
    expect(normaliseIssue({ title: 'T', body: 'b'.repeat(4000) })).toEqual(
      ok({ title: 'T', body: 'b'.repeat(4000) }),
    )
    expect(normaliseIssue({ title: 'T', body: 'b'.repeat(4001) })).toEqual(fail('body_too_long'))
    expect(normaliseIssue({ title: 'T', body: ' \u200B ' })).toEqual(ok({ title: 'T', body: '' }))
  })

  it('takes a title of 120, refuses 121 and an empty one, and makes it one line', () => {
    expect(normaliseIssue({ title: 'a'.repeat(120), body: '' })).toEqual(
      ok({ title: 'a'.repeat(120), body: '' }),
    )
    expect(normaliseIssue({ title: 'a'.repeat(121), body: '' })).toEqual(fail('title_too_long'))
    expect(normaliseIssue({ title: ' \n ', body: 'b' })).toEqual(fail('title_empty'))
    expect(normaliseIssue({ title: 'a\nb', body: ' x\r\ny ' })).toEqual(
      ok({ title: 'a b', body: 'x\ny' }),
    )
  })
})

describe('nextStatus', () => {
  it.each<[SuggestionStatus, SuggestionMove, ReturnType<typeof nextStatus>]>([
    ['new', 'send', ok('sent')],
    ['new', 'dismiss', ok('dismissed')],
    ['new', 'done', ok('done')],
    ['sent', 'done', ok('done')],
    ['sent', 'send', fail('not_new')],
    ['sent', 'dismiss', fail('not_new')],
    ['done', 'send', fail('closed')],
    ['done', 'done', fail('closed')],
    ['done', 'dismiss', fail('closed')],
    ['dismissed', 'send', fail('closed')],
    ['dismissed', 'done', fail('closed')],
    ['dismissed', 'dismiss', fail('closed')],
  ])('%s + %s', (from, move, expected) => {
    expect(nextStatus(from, move)).toEqual(expected)
  })
})

describe('issueDraft', () => {
  it('takes the title and the description, never anything else', () => {
    expect(issueDraft({ title: 'T', description: null })).toStrictEqual({ title: 'T', body: '' })
    expect(issueDraft({ title: 'T', description: 'D' })).toStrictEqual({ title: 'T', body: 'D' })
  })
})

describe('issueBody', () => {
  it('ends the body with the fixed footer after a blank line', () => {
    expect(ISSUE_FOOTER).toBe('_Suggested in the Taskmaster app._')
    expect(issueBody('D')).toBe(`D\n\n${ISSUE_FOOTER}`)
  })

  it('is only the footer when the body is empty', () => {
    expect(issueBody('')).toBe(ISSUE_FOOTER)
  })
})
