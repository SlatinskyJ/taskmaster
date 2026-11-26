// What changed between two texts (#207, Jakub 2026-11-26: a brother sees what a new description
// changes before he says yes). A word diff: the texts are cut into words, spaces and punctuation,
// the longest run of pieces both share stays, the rest is removed (first) or added. Descriptions are at
// most 1000 characters, so the plain O(n·m) table is small.

export interface DiffPart {
  kind: 'same' | 'added' | 'removed'
  text: string
}

const PIECE = /[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]+/gu

const pieces = (text: string) => text.match(PIECE) ?? []

/** The parts of `before` and `after`, in order; same-kind neighbours are joined. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = pieces(before)
  const b = pieces(after)
  // lcs(i, j): the longest common run of a[i..] and b[j..], in one flat table.
  const width = b.length + 1
  const table = new Uint16Array((a.length + 1) * width)
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1))
    }
  }
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text = '') => {
    const last = out.at(-1)
    if (last?.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('same', a[i++])
      j++
    } else if (i < a.length && (j === b.length || lcs(i + 1, j) >= lcs(i, j + 1))) {
      push('removed', a[i++])
    } else {
      push('added', b[j++])
    }
  }
  return tidy(out)
}

/**
 * A lone space kept between two changes reads as noise ("~~,~~ ~~stůl~~"): it joins the change,
 * and each change run becomes one removed part then one added part.
 */
function tidy(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  let removed = ''
  let added = ''
  const same = (text: string) => {
    const last = out.at(-1)
    if (last?.kind === 'same') last.text += text
    else out.push({ kind: 'same', text })
  }
  const flush = () => {
    // Spaces both sides end with stay kept, not changed.
    let tail = 0
    while (
      tail < Math.min(removed.length, added.length) &&
      removed.at(-1 - tail) === added.at(-1 - tail) &&
      /\s/.test(removed.at(-1 - tail) ?? '')
    )
      tail++
    const keep = removed.slice(removed.length - tail)
    if (removed.length > tail)
      out.push({ kind: 'removed', text: removed.slice(0, removed.length - tail) })
    if (added.length > tail) out.push({ kind: 'added', text: added.slice(0, added.length - tail) })
    if (keep) same(keep)
    removed = ''
    added = ''
  }
  parts.forEach((p, k) => {
    const next = parts[k + 1]
    const between = next !== undefined && next.kind !== 'same'
    if (p.kind === 'same' && between && (removed || added) && /^\s+$/.test(p.text)) {
      removed += p.text
      added += p.text
    } else if (p.kind === 'same') {
      flush()
      same(p.text)
    } else if (p.kind === 'removed') removed += p.text
    else added += p.text
  })
  flush()
  return out
}
