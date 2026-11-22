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
  /** Login screen (UI doc §7.4). Passkey texts are under `passkeys`. */
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
    /** Úkoly group of proposed tasks, negotiating ones included (#41). */
    groupProposed: 'Návrhy a vyjednávání',
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
      templateNotAgreed: 'Tenhle opakovaný úkol ještě není domluvený.',
    },
  },
  /** Recurring templates (#37): GCreate recurring part, GTasks, TApprove (UI doc §7). */
  /** Instances of a recurring chore made by a person (#38, UI doc §7.2 GTasks). */
  instances: {
    /** A parent's button on an agreed template: one more instance right now. */
    now: '+ Teď',
    toast: { created: 'Přidáno do úkolů' },
    /** An instance row: its due time ("do zítra 7:00"). */
    dueToday: (time: string) => `do ${time}`,
    dueTomorrow: (time: string) => `do zítra ${time}`,
    dueOn: (weekday: string, time: string) => `do ${weekday} ${time}`,
    overdue: 'po termínu',
    /** An on-demand instance without a deadline: when a parent made it. */
    onDemandAt: (time: string) => `na vyžádání · ${time}`,
    errors: {
      pastGrace: 'Termín už prošel, tohle už nejde.',
      scoreChanged: 'Cena se mezitím změnila, podívej se znovu.',
    },
  },
  templates: {
    kindOneTime: 'Jednorázový',
    kindRecurring: 'Opakovaný',
    /** Section on Úkoly. */
    section: 'Opakované',
    /** Section above the one-time tasks on Úkoly, so its empty line can't read as "no tasks". */
    oneTimeSection: 'Jednorázové',
    /** Úkoly's top section once it holds instances of recurring chores too (#38). */
    itemsSection: 'K udělání',
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
    /** Under a brother's send button. */
    bidHint: 'Nabídka půjde rodičům.',
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
  /**
   * Score change of an agreed recurring template (spec §5.1): its price page and ways in. The
   * stepper, send button and hints reuse `bids`.
   */
  templatePrice: {
    history: 'Historie ceny',
    noHistory: 'Zatím beze změny ceny.',
    now: (score: number) => `Platí ${String(score)} b.`,
    futureOnly: 'Nová cena platí jen pro nově vzniklé úkoly.',
    /** A brother's Domů: agreed templates, each with "Jiná cena" (until Zapsat #38). */
    recurring: 'Opakované úkoly',
    change: 'Změnit cenu',
    acceptOffer: (score: number) => `Přijmout ${String(score)}`,
    acceptBid: (score: number, names: string) => `Přijmout ${String(score)} (${names})`,
    /** Under every accept: only instances made later take the new score (§5.1). */
    acceptHint: 'Nové úkoly budou za tolik bodů.',
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
  /** Changing the price of an agreed one-time task (#36, spec §5.2): GTask, TApprove. */
  taskPrice: {
    change: 'Změnit cenu',
    /** Under "Změnit cenu" on a reserved task: who has to agree ("Stačí souhlas: Starší"). */
    needs: (name: string) => `Stačí souhlas: ${name}`,
    /** The giver side, as a taker on a reserved task sees it. */
    parent: 'rodič',
    needsOpen: 'Platí, až souhlasí rodič i jeden z kluků',
    drawerText: (score: number) =>
      `Nová cena platí, až ji potvrdí druhá strana. Do té doby zůstává ${String(score)} b.`,
    send: (score: number) => `Navrhnout ${String(score)} b`,
    pending: 'Návrh nové ceny',
    agree: 'Souhlasím',
    disagree: 'Nesouhlasím',
    withdraw: 'Stáhnout návrh',
    oldStays: (score: number) => `Dokud se nedomluvíte, platí ${String(score)} b.`,
    disagreeHint: (score: number) => `Nesouhlas návrh zavře, dál platí ${String(score)} b.`,
    withdrawHint: (score: number) => `Dál platí ${String(score)} b.`,
    /** "Čeká na tebe" row: "Nová cena: 18 → 20 b". */
    rowMeta: (from: number, to: number) => `Nová cena: ${String(from)} → ${String(to)} b`,
    toast: {
      proposed: 'Návrh odeslán',
      agreed: 'Cena změněna',
      approved: 'Souhlas zapsán',
      declined: 'Návrh zamítnut',
      withdrawn: 'Návrh stažen',
    },
    errors: {
      notInvolved: 'Tohle rozhodují jiní.',
      changePending: 'O nové ceně se už jedná. Obnov stránku.',
      noChange: 'Návrh už neplatí. Obnov stránku.',
      scoreFrozen: 'Úkol je hotový, cenu už měnit nejde.',
      notAgreed: 'Úkol se zase vyjednává. Obnov stránku.',
    },
  },
  /** A giver cancels a task (#36, spec §5.6): GTask and its Dialog. */
  cancelTask: {
    action: 'Zrušit úkol',
    hint: 'Zůstane v historii jako zrušený',
    title: 'Zrušit úkol?',
    body: 'Úkol zmizí ze seznamů, ale zůstane v historii. Vrátit to nejde.',
    reason: 'Důvod (uvidí ho všichni)',
    confirm: 'Zrušit úkol',
    back: 'Zpět',
    done: 'Úkol zrušen',
  },
  /** A task's history (#36, GTask): "so 21. 11. 10:12 · Táta: nový úkol za 8 b". */
  history: {
    title: 'Historie',
    you: 'ty',
    created: (n: number) => `nový úkol za ${String(n)} b`,
    countered: (n: number) => `nabídka ${String(n)} b`,
    bid: (n: number) => `chce ${String(n)} b`,
    bidAccepted: (n: number) => `přijato ${String(n)} b`,
    approved: (n: number) => `souhlas s ${String(n)} b`,
    agreed: (n: number) => `domluveno za ${String(n)} b`,
    agreedReserved: (n: number, name: string) => `domluveno za ${String(n)} b · rezervace: ${name}`,
    reserved: 'rezervace',
    released: 'uvolněno',
    completed: 'hotovo',
    completionApproved: 'schváleno',
    rejected: 'vráceno',
    cancelled: 'zrušeno',
    changeProposed: (n: number) => `návrh nové ceny ${String(n)} b`,
    changeApproved: (n: number) => `souhlas s novou cenou ${String(n)} b`,
    changeDeclined: (n: number) => `nesouhlas s novou cenou ${String(n)} b`,
    changeWithdrawn: 'návrh ceny stažen',
    changed: (n: number) => `nová cena ${String(n)} b`,
    changeDiscarded: (n: number) => `návrh ceny ${String(n)} b propadl`,
    /** A recurring chore's instance (#38): "+ Teď" by a parent, or logged by a boy. */
    instanceCreated: (n: number) => `přidáno za ${String(n)} b`,
    selfLogged: (n: number) => `zapsáno za ${String(n)} b`,
    other: 'změna',
  },
  home: {
    greeting: 'Ahoj',
    /** "Čeká na tebe (2)" (UI doc §6 [call]: always at the top of Domů). */
    waiting: 'Čeká na tebe',
    /** A parent's Domů with nothing to answer (UI doc §8). */
    giverEmpty: 'Teď na tebe nic nečeká.',
    /** GHome: offers still waiting for a brother's yes (#41). */
    waitingOnTakers: 'Čeká na kluky',
  },
  meeting: {
    /** The weekly meeting (spec §5.9, UI doc §7.3), giver only. Title is `cs.nav.meeting`. */
    steps: ['Schválit', 'Vyúčtovat', 'Plánovat'],
    /** Day names after "do" (genitive), Sunday first like `weekday`. */
    untilDays: ['neděle', 'pondělí', 'úterý', 'středy', 'čtvrtka', 'pátku', 'soboty'],
    pendingHint: (end: string) => `Hotová práce do ${end}. Dokud tu něco zbývá, nejde vyúčtovat.`,
    allClear: 'Vše vyřízeno',
    allClearHint: 'Můžeš vyúčtovat týden.',
    next: 'Dál: vyúčtovat',
    left: (n: number) => `Zbývá schválit: ${String(n)}`,
    levelsLabel: 'Hranice',
    level: { upper: 'Horní hranice', lower: 'Spodní hranice', none: 'Bez kapesného' },
    total: 'Celkem',
    deducted: 'Odečte se',
    carry: 'Převádí se',
    /** "Chyběly 3 body. Nic nepropadá, 47 bodů jde do dalšího týdne." */
    shortfall: (missing: string, verb: string, carry: string, goes: string) =>
      `${verb} ${missing}. Nic nepropadá, ${carry} ${goes} do dalšího týdne.`,
    missingVerb: { one: 'Chyběl', few: 'Chyběly', many: 'Chybělo' },
    goesVerb: { one: 'jde', few: 'jdou', many: 'jde' },
    final: 'Vyúčtování je konečné. Opravit ho může jen správce.',
    confirm: 'Potvrdit vyúčtování',
    confirmTitle: 'Vyúčtovat týden?',
    confirmBody: 'Je to konečné, opravit ho může jen správce.',
    confirmYes: 'Vyúčtovat',
    confirmNo: 'Zpět',
    settledAt: 'Vyúčtováno',
    newWeek: 'Nový týden',
    stillRunning: 'Tento týden běží dál',
    startWith: 'Začínají s',
    planTasks: 'Úkoly na tento týden',
    planEmpty: 'Na tento týden zatím nic. Přidej úkol.',
    newTask: '+ Nový úkol',
    end: 'Ukončit schůzku',
    nothing: 'Teď není co vyúčtovat',
    settled: 'Týden je vyúčtovaný',
    errors: {
      totalsChanged: 'Mezitím se změnily body. Zkontroluj je a potvrď znovu.',
      pendingItems: 'Přibylo něco ke schválení.',
      alreadySettled: 'Týden už je vyúčtovaný.',
      noTakers: 'Zatím tu nejsou žádné děti.',
      generic: 'Vyúčtování se nepovedlo. Zkus to znovu.',
    },
  },
  /** Týden (#45): this week and the settled weeks. */
  week: {
    myTitle: 'Můj týden',
    thisWeek: 'Tento týden',
    history: 'Historie',
    carried: (points: string) => `Z minula převedeno ${points}`,
    /** An ended week no meeting has settled yet: its points, apart from this week's. */
    unsettled: (points: string) => `Z minulého týdne čeká na poradu: ${points}`,
    happened: 'Co se tento týden stalo',
    noItems: 'Tento týden zatím nic hotového.',
    noPeriod: 'Týden ještě nezačal.',
    noHistory: 'Zatím žádné vyúčtování.',
    total: 'Celkem',
    deducted: 'odečteno',
    carry: 'převod',
    /** Under a rejected item: the chore is back with the boy (spec §5.5). */
    returnedToMe: 'Vráceno tobě.',
    returnedTo: (name: string) => `Vráceno: ${name}.`,
    /** Under a rejected self-logged chore with no reason: it ends there (#38). */
    rejectedClosed: 'Zamítnuto, bez bodů.',
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
  /**
   * Passkeys (spec §11, UI doc §7.4/§7.5, #29). One name for the feature everywhere:
   * "přihlášení otiskem / obličejem". Only the admin's count says "klíč".
   */
  passkeys: {
    loginButton: 'Přihlásit otiskem / obličejem',
    /** Under the button (Login mockup): a first login has no passkey yet. */
    hint: 'První přihlášení nebo nový telefon? Použij heslo.',
    or: 'nebo heslem',
    unknown: 'Přihlášení otiskem tu už neplatí. Přihlas se heslem.',
    offerTitle: 'Přihlásit otiskem / obličejem',
    offerText:
      'Příště se přihlásíš jedním dotykem, bez hesla. Funguje s Face ID, otiskem prstu nebo zámkem telefonu.',
    /** Passkey mockup: the reassurance under the offer. */
    offerSafe: 'Obličej ani otisk neopustí tvůj telefon. Heslo zadáš jen na novém telefonu.',
    offerSet: 'Nastavit',
    offerLater: 'Teď ne',
    added: 'Hotovo. Příště stačí otisk nebo obličej.',
    already: 'Tohle zařízení už přihlášení otiskem má.',
    section: 'Přihlášení otiskem / obličejem',
    addHere: 'Přidat toto zařízení',
    addedOn: (date: string) => `Přidáno ${date}`,
    lastUsed: (date: string) => `Naposledy ${date}`,
    neverUsed: 'Zatím nepoužito',
    /** The passkey this browser added (Profile mockup: "Zapnuto na tomto telefonu"). */
    thisDevice: 'Toto zařízení',
    remove: 'Odebrat',
    cancel: 'Zrušit',
    removeConfirmTitle: (device: string, date: string) =>
      `Odebrat přihlášení: ${device}, přidáno ${date}?`,
    removeConfirmText: 'Na tom zařízení se pak přihlásíš heslem.',
    removed: 'Odebráno.',
    empty: 'Zatím žádné. Přidej toto zařízení.',
    /** The device a passkey was added on, guessed from the browser (server: deviceKind.ts). */
    device: {
      iphone: 'iPhone',
      ipad: 'iPad',
      android: 'Android',
      mac: 'Mac',
      windows: 'Windows',
      linux: 'Linux',
      other: 'Jiné zařízení',
    },
    admin: {
      removeAll: 'Odebrat klíče',
      confirmTitle: (name: string) => `Odebrat klíče: ${name}?`,
      /** Security judge, PR #132: removing passkeys leaves open sessions alone. */
      confirmText: 'Telefon tím neodhlásíš. Odhlásí ho až nové heslo.',
      removed: 'Klíče odebrány.',
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
    /** Under the bar on Domů (mockup Main): how far the certain points are from the next level. */
    missingLower: (n: number) => `Do spodní hranice chybí ${formatPoints(n)}.`,
    missingUpper: (n: number) => `Do horní hranice chybí ${formatPoints(n)}.`,
    upperDone: 'Horní hranice splněna!',
    /** GHome: every taker's points this week (#41). */
    takersTitle: 'Kluci tento týden',
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

export const keyWords: PluralForms = { one: 'klíč', few: 'klíče', many: 'klíčů' }

/** `1 klíč`, `3 klíče`, `5 klíčů`: the admin's passkey count on Správa. */
export function formatKeys(n: number): string {
  return `${String(n)} ${plural(n, keyWords)}`
}

/** `5 bodů`, `1 bod`, `-3 body`. */
export function formatPoints(n: number): string {
  return `${n} ${plural(n, pointWords)}`
}
