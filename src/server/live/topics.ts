// Live change topics (#299, design docs/superpowers/specs/2026-11-26-live-changes-design.md).
// A topic names what a screen loaded; a change fires the topics of what it touched, and the hub
// sends the change to the streams that share one (./README.md).
//
// The rule: a broad topic (`disputes`, `suggestions`, `templates:proposed`) is only for viewers
// who may load every row of it; a viewer who may load only a slice subscribes to the slice
// topics (`disputes:about:<taker>`, `disputes:by:<user>`, `suggestions:by:<author>`). A change
// fires the broad topic and every slice it belongs to. The data function that issues a topic is
// the one that checked the viewer may read it: the stream only accepts topics the server signed
// (./subscription.ts).

export type Topic =
  | 'tasks'
  | `task:${number}`
  | 'templates'
  | 'templates:proposed'
  | `template:${number}`
  | 'week'
  | 'proposals'
  | 'settings'
  | 'people'
  /** A taker's totals, by user id. */
  | `points:${number}`
  | 'disputes'
  | `disputes:about:${number}`
  | 'disputes:about:none'
  | `disputes:by:${number}`
  | 'suggestions'
  | `suggestions:by:${number}`

/** Most topics one stream may carry: twice the largest screen's count (design "Limits"). */
export const TOPIC_LIMIT = 20

const FIXED = new Set<string>([
  'tasks',
  'templates',
  'templates:proposed',
  'week',
  'proposals',
  'settings',
  'people',
  'disputes',
  'disputes:about:none',
  'suggestions',
])
const WITH_ID =
  /^(?:task|template|points|disputes:about|disputes:by|suggestions:by):([1-9]\d{0,15})$/

export function isTopic(s: string): s is Topic {
  if (FIXED.has(s)) return true
  const m = WITH_ID.exec(s)
  return m !== null && Number.isSafeInteger(Number(m[1]))
}

/** The topics that end in an id. */
export type IdTopicKind =
  'task' | 'template' | 'points' | 'disputes:about' | 'disputes:by' | 'suggestions:by'

/** `kind:id`, e.g. `idTopic('task', 12)` is `task:12`. */
export function idTopic(kind: IdTopicKind, id: number): Topic {
  return `${kind}:${String(id)}` as Topic
}
