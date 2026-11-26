import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import type {
  DescriptionOutcome,
  DescriptionResult,
  DescriptionTarget,
} from '~/server/descriptions/functions'
import type { TaskView } from '~/server/tasks/functions'
import type { Me } from '~/components/tasks/taskView'

// The one place the description sheet and the waiting card (#207) reach the server, and the one
// place a page asks whether its viewer may edit the text (ruling 4). Framework-free.

export type DescriptionCallResult<O> = { ok: true; outcome: O } | { ok: false; error: string }

type ChangeCall = (args: {
  data: DescriptionTarget & { description: string }
}) => Promise<DescriptionResult>
type AnswerCall = (args: {
  data: DescriptionTarget & { changeId: number; yes: boolean }
}) => Promise<DescriptionResult>

async function run<O extends DescriptionOutcome>(
  call: () => Promise<DescriptionResult>,
): Promise<DescriptionCallResult<O>> {
  try {
    const r = await call()
    return r.ok
      ? { ok: true, outcome: r.outcome as O }
      : { ok: false, error: taskErrorMessage(r.error) }
  } catch {
    return { ok: false, error: cs.login.failed }
  }
}

/** A giver's new text ('' removes it; the text in force takes a waiting change back). */
export function sendDescription(
  target: DescriptionTarget,
  text: string,
  fn: ChangeCall,
): Promise<DescriptionCallResult<'applied' | 'waiting' | 'withdrawn'>> {
  return run(() => fn({ data: { ...target, description: text } }))
}

/** Ruling 7: a parent takes a waiting change back by sending the text in force ('' for none). */
export function takeBackDescription(
  target: DescriptionTarget,
  inForce: string | null,
  fn: ChangeCall,
): Promise<DescriptionCallResult<'applied' | 'waiting' | 'withdrawn'>> {
  return sendDescription(target, inForce ?? '', fn)
}

/** A brother's yes or no to the waiting change his page showed. */
export function answerDescription(
  target: DescriptionTarget,
  changeId: number,
  yes: boolean,
  fn: AnswerCall,
): Promise<DescriptionCallResult<'agreed' | 'declined'>> {
  return run(() => fn({ data: { ...target, changeId, yes } }))
}

export function descriptionToast(outcome: DescriptionOutcome): string {
  return cs.description.toast[outcome]
}

export type EditableItem =
  { kind: 'task'; status: TaskView['status']; origin: TaskView['origin'] } | { kind: 'template' }

/** Ruling 4: a parent, on a one-time task before it is done, or on any chore. */
export function canEditDescription(item: EditableItem, me: Me): boolean {
  if (me.role !== 'giver') return false
  if (item.kind === 'template') return true
  return (
    item.origin === 'one_time' &&
    (item.status === 'proposed' || item.status === 'open' || item.status === 'reserved')
  )
}

/** What the edit sheet opens with: the waiting text if a change waits ('' for a removal), else the text in force. */
export function sheetStart(
  text: string | null,
  change: { description: string | null } | null,
): string {
  return change ? (change.description ?? '') : (text ?? '')
}
