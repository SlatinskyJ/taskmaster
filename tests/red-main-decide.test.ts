import { describe, expect, it } from 'vitest'
import { decide, formatMail, type Action, type Run } from '../scripts/red-main/decide.ts'

const REPO = 'https://github.com/SlatinskyJ/taskmaster'

function run(runNumber: number, conclusion: string | null, over: Partial<Run> = {}): Run {
  return {
    id: 46042649000 + runNumber,
    runNumber,
    attempt: 1,
    headSha: `${String(runNumber)}${'a'.repeat(37)}`,
    title: `Commit ${String(runNumber)}`,
    conclusion,
    htmlUrl: `${REPO}/actions/runs/${String(46042649000 + runNumber)}`,
    ...over,
  }
}

function mail(a: Action) {
  if (a.kind !== 'send') throw new Error(`expected send, got none: ${a.reason}`)
  return a.mail
}

describe('decide', () => {
  it('red with no newer run sends "main is broken" naming sha, run, commit and every failed job', () => {
    const r = run(512, 'failure')
    const m = mail(decide(r, [run(511, 'success'), r], ['build', 'test'], false, REPO))
    expect(m.subject).toBe('Taskmaster: main is broken (512aaaa)')
    expect(m.text).toContain('Commit 512')
    expect(m.text).toContain(`${REPO}/commit/${r.headSha}`)
    expect(m.text).toContain(r.htmlUrl)
    expect(m.text).toContain('build\n')
    expect(m.text).toContain('test\n')
    expect(m.text).toContain('Production was not deployed from this commit.')
  })

  it('red after red sends again', () => {
    const r = run(512, 'failure')
    const a = decide(r, [run(511, 'failure'), r], ['build'], false, REPO)
    expect(mail(a).subject).toBe('Taskmaster: main is broken (512aaaa)')
  })

  it('green right after red sends "green again"', () => {
    const r = run(512, 'success')
    const m = mail(decide(r, [r, run(511, 'failure')], [], false, REPO))
    expect(m.subject).toBe('Taskmaster: main is green again (512aaaa)')
    expect(m.text).toContain('Commit 512')
    expect(m.text).toContain(r.htmlUrl)
  })

  it('green after green sends nothing, even with an older red further back', () => {
    const r = run(512, 'success')
    const a = decide(r, [run(510, 'failure'), run(511, 'success'), r], [], false, REPO)
    expect(a).toEqual({ kind: 'none', reason: 'still green' })
  })

  it('green with no earlier run sends nothing', () => {
    const r = run(512, 'success')
    expect(decide(r, [r], [], false, REPO)).toEqual({ kind: 'none', reason: 'still green' })
    expect(decide(r, [], [], false, REPO)).toEqual({ kind: 'none', reason: 'still green' })
  })

  it('a re-run green attempt after a red attempt sends "green again"', () => {
    const r = run(512, 'success', { attempt: 2 })
    const m = mail(decide(r, [run(511, 'success'), r], [], true, REPO))
    expect(m.subject).toBe('Taskmaster: main is green again (512aaaa)')
  })

  it('a re-run green attempt after a green attempt with 511 green sends nothing', () => {
    const r = run(512, 'success', { attempt: 2 })
    expect(decide(r, [run(511, 'success'), r], [], false, REPO)).toEqual({
      kind: 'none',
      reason: 'still green',
    })
  })

  it('green skips a cancelled run in between: red, cancelled, green sends "green again"', () => {
    const r = run(512, 'success')
    const a = decide(r, [run(510, 'failure'), run(511, 'cancelled'), r], [], false, REPO)
    expect(mail(a).subject).toBe('Taskmaster: main is green again (512aaaa)')
  })

  it('a newer completed run (run_number + 1) means none; the run itself in the list (same run_number) does not count', () => {
    const r = run(512, 'failure')
    expect(decide(r, [r, run(513, 'success')], ['build'], false, REPO)).toEqual({
      kind: 'none',
      reason: 'newer run',
    })
    expect(decide(r, [r, run(513, 'cancelled')], ['build'], false, REPO)).toEqual({
      kind: 'none',
      reason: 'newer run',
    })
    expect(decide(r, [r], ['build'], false, REPO).kind).toBe('send')
  })

  it.each(['cancelled', 'skipped', 'neutral', 'action_required', 'stale', null])(
    '%s sends nothing',
    (conclusion) => {
      const r = run(512, conclusion)
      expect(decide(r, [run(511, 'failure'), r], [], true, REPO)).toEqual({
        kind: 'none',
        reason: 'not red or green',
      })
    },
  )

  it.each(['timed_out', 'startup_failure'])('%s counts as red', (conclusion) => {
    const r = run(512, conclusion)
    expect(mail(decide(r, [r], [], false, REPO)).subject).toBe(
      'Taskmaster: main is broken (512aaaa)',
    )
  })
})

describe('formatMail', () => {
  const date = new Date('2026-11-27T10:00:00Z')

  it('strips CR and LF from the subject and cuts it at 120 characters', () => {
    const out = formatMail(
      'a@x\r\nBcc: evil@y',
      'b@x\n',
      { subject: `Hi\r\nBcc: evil@y ${'z'.repeat(200)}`, text: 'body' },
      date,
    )
    const headers = out.split('\r\n\r\n')[0] ?? ''
    const lines = headers.split('\r\n')
    expect(lines.some((l) => l.startsWith('Bcc:'))).toBe(false)
    const subject = lines.find((l) => l.startsWith('Subject: ')) ?? ''
    expect(subject.slice('Subject: '.length)).toHaveLength(120)
    expect(subject.startsWith('Subject: HiBcc: evil@y ')).toBe(true)
    expect(lines).toContain('From: a@xBcc: evil@y')
    expect(lines).toContain('To: b@x')
  })

  it('turns every body line ending into CRLF and leaves no bare LF anywhere', () => {
    const out = formatMail('a@x', 'b@x', { subject: 's', text: 'one\ntwo\r\nthree\n' }, date)
    expect(out.endsWith('\r\n\r\none\r\ntwo\r\nthree\r\n')).toBe(true)
    expect(/(^|[^\r])\n/.test(out)).toBe(false)
  })

  it('uses CRLF and the UTF-8 headers', () => {
    const out = formatMail('a@x', 'b@x', { subject: 'Žluťoučký', text: 'b' }, date)
    expect(out).toBe(
      [
        'From: a@x',
        'To: b@x',
        'Subject: Žluťoučký',
        'Date: Fri, 27 Nov 2026 10:00:00 +0000',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        'b',
      ].join('\r\n'),
    )
  })
})
