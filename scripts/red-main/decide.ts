// What a finished CI run on main emails Jakub (#338): "main is broken" for a red run, and
// "main is green again" for the first green run after a red one. Pure; run.ts does the I/O.

export interface Run {
  id: number
  runNumber: number
  attempt: number
  headSha: string
  title: string
  conclusion: string | null
  htmlUrl: string
}
export interface Mail {
  subject: string
  text: string
}
export type Action = { kind: 'send'; mail: Mail } | { kind: 'none'; reason: string }

const RED = new Set(['failure', 'timed_out', 'startup_failure'])
const isRed = (r: Run) => r.conclusion !== null && RED.has(r.conclusion)
const isGreen = (r: Run) => r.conclusion === 'success'

/**
 * `completed`: recent completed push runs on main, any order, may include `run`.
 * `previousAttemptRed`: run.attempt > 1 and that run's attempt (attempt - 1) was red.
 */
export function decide(
  run: Run,
  completed: Run[],
  failedJobs: string[],
  previousAttemptRed: boolean,
  repoUrl: string,
): Action {
  // A late run behind a newer one says nothing: the newer run already spoke for main.
  if (completed.some((r) => r.runNumber > run.runNumber))
    return { kind: 'none', reason: 'newer run' }
  const short = run.headSha.slice(0, 7)
  if (isRed(run)) {
    const text = [
      run.title,
      '',
      `Commit: ${repoUrl}/commit/${run.headSha}`,
      `Run: ${run.htmlUrl}`,
      '',
      'Failed jobs:',
      ...failedJobs,
      '',
      'Production was not deployed from this commit.',
      '',
    ].join('\n')
    return { kind: 'send', mail: { subject: `Taskmaster: main is broken (${short})`, text } }
  }
  if (!isGreen(run)) return { kind: 'none', reason: 'not red or green' }
  const previous = completed
    .filter((r) => r.runNumber < run.runNumber && (isRed(r) || isGreen(r)))
    .sort((a, b) => b.runNumber - a.runNumber)[0]
  if (!previousAttemptRed && !(previous && isRed(previous))) {
    return { kind: 'none', reason: 'still green' }
  }
  const text = [run.title, '', `Run: ${run.htmlUrl}`, ''].join('\n')
  return { kind: 'send', mail: { subject: `Taskmaster: main is green again (${short})`, text } }
}

const oneLine = (v: string) => v.replace(/[\r\n]/g, '')

/** The whole message for curl's --upload-file: RFC 5322, CRLF line ends throughout. */
export function formatMail(from: string, to: string, mail: Mail, date: Date): string {
  const headers = [
    `From: ${oneLine(from)}`,
    `To: ${oneLine(to)}`,
    `Subject: ${oneLine(mail.subject).slice(0, 120)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ]
  const body = mail.text.replace(/\r\n|\r|\n/g, '\r\n')
  return `${headers.join('\r\n')}\r\n\r\n${body}`
}
