// Every Czech UI label lives here (spec §7, §11), so screens never inline Czech text.
// Keys are English; add new ones under the screen or concept they belong to.
// Item states: UI design doc §2.2.

export const cs = {
  app: {
    name: 'Taskmaster',
    /** Under the name on the login screen. */
    tagline: 'Body za domácí práce',
  },
  /** Bottom bars (UI doc §6). */
  nav: {
    label: 'Hlavní menu',
    home: 'Domů',
    log: 'Zapsat',
    week: 'Týden',
    tasks: 'Úkoly',
    meeting: 'Schůzka',
  },
  /** One friendly line on pages whose content lands in later issues (UI doc §8 [call]). */
  placeholder: {
    soon: 'Tady brzy něco bude.',
  },
  notFound: {
    message: 'Tahle stránka neexistuje.',
  },
  /** Login screen (UI doc §7.4). The passkey button comes with #29. */
  login: {
    title: 'Přihlášení',
    /** Accounts come from the admin only (spec §6). */
    help: 'Účty zakládá správce. Zapomenuté heslo? Řekni správci.',
    username: 'Jméno',
    password: 'Heslo',
    submit: 'Přihlásit',
    invalid: 'Špatné jméno nebo heslo.',
    rateLimited: 'Moc pokusů. Zkus to za 15 minut.',
    failed: 'Něco se pokazilo. Zkus to znovu.',
    logout: 'Odhlásit',
  },
  /** Profile (UI doc §7.4): theme, effects, log out. */
  profile: {
    title: 'Profil',
    open: 'Otevřít profil',
    back: 'Zpět',
    appearance: 'Vzhled',
    themeLight: 'Světlý',
    themeDark: 'Tmavý',
    themeAuto: 'Podle telefonu',
    effects: 'Efekty',
    effectsLabel: 'Konfety a animace',
    effectsHint: 'Když dokončíš úkol nebo dosáhneš hranice',
  },
  /** One-time tasks (#33): GTasks, GCreate, TApprove (UI doc §7). */
  tasks: {
    new: '+ Nový',
    empty: 'Zatím žádné úkoly.',
    createTitle: 'Nový úkol',
    title: 'Název',
    score: 'Body',
    less: 'Méně',
    more: 'Více',
    approvalRequired: 'Po dokončení schvaluji já',
    propose: 'Navrhnout',
    proposeHint: 'Úkol bude volný, až cenu schválí jeden z kluků.',
    created: 'Úkol navržen',
    /** Followed by the giver's name: "Nabízí Táta". */
    offeredBy: 'Nabízí',
    waitingForTaker: 'Čeká na souhlas',
    approve: 'Souhlasím',
    approved: 'Schváleno',
    errors: {
      invalidTitle: 'Napiš název (nejvýš 80 znaků).',
      invalidScore: 'Body musí být celé číslo od 1.',
      offerChanged: 'Cena se mezitím změnila. Podívej se znovu.',
      gone: 'Tenhle úkol už je vyřízený.',
    },
  },
  home: {
    greeting: 'Ahoj',
    /** "Čeká na tebe (2)" (UI doc §6 [call]: always at the top of Domů). */
    waiting: 'Čeká na tebe',
  },
  admin: {
    title: 'Správa',
    people: 'Lidé',
  },
  roles: {
    taker: 'Bere úkoly',
    giver: 'Zadává úkoly',
    admin: 'Správce',
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
    /** Tick labels under the points bar, UI doc §3: `spodní 50`, `horní 100`. */
    lowerTick: 'spodní',
    upperTick: 'horní',
  },
  /** Effects, UI doc §4. */
  effects: {
    lowerReached: 'Spodní hranice!',
    upperReached: 'Horní hranice!',
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
