// Every Czech UI label lives here (spec §7, §11), so screens never inline Czech text.
// Keys are English; add new ones under the screen or concept they belong to.
// Item states: UI design doc §2.2.

export const cs = {
  app: {
    name: 'Taskmaster',
  },
  nav: {
    home: 'Domů',
  },
  notFound: {
    message: 'Tahle stránka neexistuje.',
  },
  /** Item states (spec §5.6 + rejected/disputed for display), UI design doc §2.2. */
  state: {
    proposed: 'Návrh',
    negotiating: 'Vyjednává se',
    open: 'Volné',
    reserved: 'Rezervováno',
    pending: 'Čeká na potvrzení',
    confirmed: 'Hotovo',
    expired: 'Prošlo',
    cancelled: 'Zrušeno',
    rejected: 'Zamítnuto',
    disputed: 'Sporné',
  },
  points: {
    /** Points bar, spec §5.7: `45 potvrzeno + 15 čeká · spodní hranice 50 · horní 100`. */
    confirmed: 'potvrzeno',
    pending: 'čeká',
    lowerLevel: 'spodní hranice',
    upperLevel: 'horní',
  },
} as const

export type Strings = typeof cs

/** Item state keys, in the order of UI design doc §2.2. */
export type ItemStateKey = keyof Strings['state']

/** Czech plural forms: one (1), few (2–4), many (0, 5+). For whole numbers only (points are). */
export interface PluralForms {
  one: string
  few: string
  many: string
}

export const pointWords: PluralForms = { one: 'bod', few: 'body', many: 'bodů' }

/** Picks the Czech plural form for `n` (by absolute value): 1 bod, 3 body, 5 bodů, 0 bodů. */
export function plural(n: number, forms: PluralForms): string {
  const abs = Math.abs(n)
  // Points are whole numbers; a fraction would need the genitive singular (1,5 bodu).
  if (!Number.isInteger(abs)) return forms.many
  if (abs === 1) return forms.one
  if (abs >= 2 && abs <= 4) return forms.few
  return forms.many
}

/** `5 bodů`, `1 bod`, `-3 body`. */
export function formatPoints(n: number): string {
  return `${n} ${plural(n, pointWords)}`
}
