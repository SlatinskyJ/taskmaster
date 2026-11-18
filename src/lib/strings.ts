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
  routeError: {
    title: 'Něco se nepovedlo',
    message: 'Data se nenačetla. Zkontroluj připojení a zkus to znovu.',
    retry: 'Zkusit znovu',
  },
  /** Shown by the service worker when a page cannot load offline (src/pwa/offline.ts). */
  offline: {
    title: 'Jsi offline',
    message: 'Taskmaster potřebuje internet. Až budeš zase online, zkus to znovu.',
    retry: 'Zkusit znovu',
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
    /** Before the quick-pick point values: "Rychle: 5 10 20 50". */
    quickPick: 'Rychlá volba',
    approvalRequired: 'Po dokončení schvaluji já',
    propose: 'Navrhnout',
    proposeHint: 'Úkol bude volný, až cenu schválí jeden z kluků.',
    created: 'Úkol navržen',
    /** Followed by the giver's name: "Nabízí Táta". */
    offeredBy: 'Nabízí',
    waitingForTaker: 'Čeká na souhlas',
    approve: 'Souhlasím',
    approving: 'Ukládám…',
    approved: 'Schváleno',
    errors: {
      invalidTitle: (max: number) => `Napiš název (nejvýš ${String(max)} znaků).`,
      invalidScore: 'Body musí být celé číslo od 1.',
      offerChanged: 'Cena se mezitím změnila. Podívej se znovu.',
      gone: 'Tenhle úkol už je vyřízený.',
      reservedByOther: 'Tenhle úkol si už vzal někdo jiný.',
      notAllowed: 'Tohle teď udělat nemůžeš.',
      reasonTooLong: (max: number) => `Důvod je moc dlouhý (nejvýš ${String(max)} znaků).`,
      sameScore: 'Tohle číslo už platí. Zvol jiné.',
      noBids: 'Zatím nikdo nic nenabídl.',
      noBid: 'Nejdřív nabídni svou cenu.',
    },
  },
  /** Recurring templates (#37): GCreate recurring part, GTasks, TApprove (UI doc §7). */
  templates: {
    kindOneTime: 'Jednorázový',
    kindRecurring: 'Opakovaný',
    /** Section on Úkoly. */
    section: 'Opakované',
    /** Section above the one-time tasks on Úkoly, so its empty line can't read as "no tasks". */
    oneTimeSection: 'Jednorázové',
    empty: 'Zatím žádné opakované úkoly.',
    when: 'Kdy vzniká',
    /** Index = weekday, 0 = Sunday (src/domain/dates.ts). */
    days: ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'],
    atTime: 'V čase',
    withTime: 'V určitý čas',
    noTimeHint: 'Bez času vznikne o půlnoci.',
    onDemandHint: 'Bez vybraného dne vzniká jen na požádání.',
    onDemand: 'Jen na požádání',
    deadline: 'Termín',
    noDeadline: 'Bez termínu',
    noDeadlineHint: 'čeká, dokud to někdo neudělá',
    withDeadline: 'S termínem',
    withDeadlineHint: 'pak propadne',
    dueDay: 'Hotovo do',
    /** Index = days after the instance appears. */
    dayOffsets: [
      'týž den',
      'další den',
      'za 2 dny',
      'za 3 dny',
      'za 4 dny',
      'za 5 dnů',
      'za 6 dnů',
    ],
    dueTime: 'v',
    grace: 'Zapsat jde ještě',
    hours: (n: number) => `${String(n).replace('.', ',')} h`,
    proposeHint: 'Začne platit, až cenu schválí jeden z kluků.',
    created: 'Opakovaný úkol navržen',
    /** Chip of an agreed template. */
    activeChip: 'Platí',
    recurringMeta: 'Opakovaný',
    approvalOn: 'schvaluje rodič',
    approvalOff: 'bez schvalování',
    /** Followed by names: "Souhlasí: Táta". */
    agreedBy: 'Souhlasí',
    /** Summary pieces: "Út, Pá v 18:00 · do dalšího dne 7:00 (+2 h)". */
    summary: {
      at: 'v',
      due: 'do',
      nextDay: 'dalšího dne',
    },
    errors: {
      invalidSchedule: 'Vyber aspoň jeden den.',
      invalidDeadline: 'Termín nedává smysl. Zkontroluj ho.',
      alreadyApproved: 'Souhlas už máš zapsaný.',
    },
  },
  /** Bidding on a one-time task (#34): the task page TTask / GBid and its ways in. */
  bids: {
    thread: 'Vyjednávání',
    /** "Táta nabízí 18", "Starší chce 25"; my own: "Ty nabízíš 18", "Ty chceš 25". */
    offers: 'nabízí',
    wants: 'chce',
    /** Several takers at one bid: "Starší, Mladší chtějí 22". */
    wantMany: 'chtějí',
    youOffer: 'Ty nabízíš',
    youWant: 'Ty chceš',
    /** Me in a row's short line: "Táta 20 · ty 25". */
    you: 'ty',
    yours: 'Je to tvoje',
    replaced: 'změněno',
    accepted: 'přijato',
    closed: 'uzavřeno',
    /** Who said yes to the current offer: "Souhlasí: Táta ✓". */
    agreed: 'Souhlasí',
    /** Who the offer still waits for: "Čeká se na: Starší nebo Mladší" (any one of them is enough). */
    waitingFor: 'Čeká se na',
    or: 'nebo',
    /** Me after "na": "Čeká se na: tebe nebo Mladší". */
    youAcc: 'tebe',
    approveHint: 'Úkol bude volný pro všechny.',
    take: (score: number) => `Beru za ${String(score)}`,
    takeHint: 'Úkol bude tvůj.',
    otherPrice: 'Chci jinou cenu',
    newOffer: 'Nová nabídka',
    send: 'Nabídnout',
    sendHint: 'Nová nabídka pro všechny.',
    acceptBid: (score: number, name: string) => `Přijmout ${String(score)} (${name})`,
    acceptBidHint: (name: string) => `Úkol bude rezervovaný pro ${name}.`,
    acceptTie: (score: number) => `Přijmout ${String(score)}`,
    tieHint: 'Stejnou cenu chce víc lidí. Úkol bude volný.',
    yourBid: 'Tvoje nabídka',
    toAnswer: 'Vyjednávání',
    answer: 'Odpovědět',
    otherPriceShort: 'Jiná cena',
    open: 'Otevřít',
    /** Short weekday names, Sunday first (dates.ts `Weekday`). */
    weekdays: ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'],
    toast: { sent: 'Nabídka odeslána', agreed: 'Domluveno', agreedMine: 'Domluveno, úkol je tvůj' },
  },
  /** Reserve, release, done, approve, reject (spec §5.4–§5.5). */
  work: {
    mine: 'Moje',
    free: 'Volné',
    toApprove: 'Ke schválení',
    reserve: 'Rezervovat',
    release: 'Uvolnit',
    done: 'Hotovo',
    /** A giver did it themselves: closed with no points (spec §5.5). Gender-neutral on purpose. */
    doneSelf: 'Hotovo bez bodů',
    doneSelfConfirm: {
      title: 'Hotovo bez bodů?',
      body: 'Úkol se uzavře a nikdo za něj body nedostane. Vrátit to nejde.',
      confirm: 'Uzavřít',
    },
    approve: 'Schválit',
    reject: 'Zamítnout',
    rejectReason: 'Proč? (nepovinné)',
    back: 'Zpět',
    /** Followed by a name: "Rezervoval Starší". */
    reservedBy: 'Rezervoval',
    /** Followed by a name: "Udělal Starší". */
    doneBy: 'Udělal',
    toast: {
      reserved: 'Rezervováno',
      released: 'Uvolněno',
      done: 'Hotovo!',
      pending: 'Hotovo, čeká na schválení',
      approved: 'Schváleno, body připsány',
      rejected: 'Zamítnuto',
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
    add: 'Přidat člověka',
    addTitle: 'Nový člověk',
    editTitle: 'Upravit',
    /** Accessible name of a person row. */
    editPerson: (name: string) => `Upravit ${name}`,
    displayName: 'Jméno',
    username: 'Přihlašovací jméno',
    usernameHint: 'Malá písmena bez diakritiky, třeba kuba',
    role: 'Role',
    password: 'Heslo',
    startPasswordHint: (min: number) =>
      `Aspoň ${String(min)} znaků. Řekni ho dotyčnému, pak už ho nikde neuvidíš.`,
    save: 'Uložit',
    saving: 'Ukládám…',
    cancel: 'Zrušit',
    added: 'Přidáno',
    saved: 'Uloženo',
    resetTitle: 'Nové heslo',
    reset: 'Nastavit nové heslo',
    /** The reset dialog's confirm button: short, it shares a row with Zrušit at 360 px. */
    resetSubmit: 'Změnit heslo',
    resetConfirm: (name: string) =>
      `${name} se odhlásí ze všech zařízení a přihlásí se novým heslem.`,
    resetDone: 'Heslo změněno',
    you: 'ty',
    selfHint: 'Svou roli ani heslo tady neměníš.',
    errors: {
      invalidUsername:
        'Jen malá písmena bez diakritiky, číslice a . _ -, 2 až 32 znaků, začíná písmenem.',
      usernameTaken: 'Tohle přihlašovací jméno už někdo má.',
      invalidName: (max: number) => `Jméno musí mít 1 až ${String(max)} znaků.`,
      invalidRole: 'Vyber roli.',
      invalidPassword: (min: number, max: number) =>
        `Heslo musí mít ${String(min)} až ${String(max)} znaků.`,
      lastAdmin: 'Musí zůstat aspoň jeden správce.',
      notFound: 'Tenhle člověk už neexistuje.',
      notAdmin: 'Na tohle nemáš práva.',
    },
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
