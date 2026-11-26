// Every Czech UI label lives here (spec §7, §11), so screens never inline Czech text.
// Keys are English; add new ones under the screen or concept they belong to.
// Item states: UI design doc §2.2.

export const cs = {
  /** Short weekday names, Sunday first (dates.ts `Weekday`). */
  weekdays: ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'],
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
    /** Změnit heslo (#210). */
    passwordSection: 'Heslo',
    passwordRow: 'Změnit heslo',
    passwordTitle: 'Změnit heslo',
    currentPassword: 'Současné heslo',
    newPassword: 'Nové heslo',
    newPasswordAgain: 'Nové heslo znovu',
    passwordHint: (min: number) => `Aspoň ${String(min)} znaků.`,
    logOutOthers: 'Odhlásit na ostatních zařízeních',
    passwordSubmit: 'Změnit heslo',
    passwordSaving: 'Ukládám…',
    passwordChanged: 'Heslo je změněné.',
    passwordChangedOthers: 'Heslo je změněné. Ostatní zařízení jsou odhlášená.',
    passwordErrors: {
      mismatch: 'Nová hesla se neshodují.',
      tooShort: (min: number) => `Nové heslo musí mít aspoň ${String(min)} znaků.`,
      wrong: 'Současné heslo nesedí.',
      changed: 'Heslo se mezitím změnilo. Zkus to znovu.',
      featureOff: 'Změna hesla je teď vypnutá.',
    },
  },
  /** One-time tasks (#33): GTasks, GCreate, TApprove (UI doc §7). */
  tasks: {
    /** On a chore's copy: its recurring chore's page (#205). */
    chorePageLink: 'Otevřít opakovaný úkol',
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
      offerChanged: 'Úkol se mezitím změnil. Podívej se znovu.',
      gone: 'Tenhle úkol už je vyřízený.',
      reservedByOther: 'Tenhle úkol si už vzal někdo jiný.',
      notAllowed: 'Tohle teď udělat nemůžeš.',
      reasonTooLong: (max: number) => `Důvod je moc dlouhý (nejvýš ${String(max)} znaků).`,
      sameScore: 'Tohle číslo už platí. Zvol jiné.',
      noBids: 'Zatím nikdo nic nenabídl.',
      noBid: 'Nejdřív nabídni svou cenu.',
      biddingOpen: 'Teď se o ceně vyjednává. Obnov stránku.',
      templateNotAgreed: 'Tenhle opakovaný úkol ještě není domluvený.',
    },
  },
  /** Zapsat (#38, UI doc §7.1 TLog): a brother logs a chore he did unprompted. */
  log: {
    intro: 'Udělal jsi něco sám od sebe? Zapiš to.',
    tileLabel: (title: string, n: number) => `${title}, ${String(n)} b.`,
    points: (n: number) => `${String(n)} b.`,
    confirmTitle: 'Zapsat úkol?',
    confirmBody: (title: string, n: number) =>
      `${title} za ${String(n)} b. Rodič to ještě schválí.`,
    confirm: 'Zapsat',
    toast: 'Zapsáno, čeká na schválení',
    /** A chore with a copy on the board can't be logged (Jakub 2026-11-22): take that one. */
    onBoard: 'Už je zadaný na Domů',
    tileOnBoardLabel: (title: string) => `${title}, už je zadaný na Domů`,
    /** "Kdy?" (Jakub 2026-11-22): Dnes ráno = today 7:00, Včera = yesterday 18:00. */
    when: { label: 'Kdy?', now: 'Teď', this_morning: 'Dnes ráno', yesterday: 'Včera' },
    empty: 'Zatím tu nejsou žádné domluvené opakované úkoly. Až je rodiče přidají, objeví se tady.',
  },
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
    /**
     * A scheduled instance without a deadline (#39): when its slot was, first, so a row cut at
     * 360 px still shows it ("včera 7:00 · podle rozvrhu").
     */
    scheduledAt: (when: string) => `${when} · podle rozvrhu`,
    today: (time: string) => `dnes ${time}`,
    yesterday: (time: string) => `včera ${time}`,
    errors: {
      pastGrace: 'Termín už prošel, tohle už nejde.',
      scoreChanged: 'Cena se mezitím změnila, podívej se znovu.',
      alreadyOpen: 'Tenhle úkol už je zadaný. Najdeš ho na Domů.',
      tooEarly: 'Tohle už patří do minulého týdne.',
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
    /** Same number (Jakub 2026-11-24): under a disabled Nabídnout on his previous bid. */
    sameAgainHint: 'Stejné číslo můžeš poslat znovu, až rodiče změní nabídku.',
    /** A brother's no (#208): only his own bid closes. */
    withdraw: 'Nechci',
    withdrawHint: 'Tvoje nabídka se uzavře. Nabídnout můžeš znovu.',
    /** A parent's no (#208): every bid closes, the offer stays. */
    turnDown: 'Odmítnout nabídky',
    turnDownHint: (score: number) =>
      `Všechny nabídky se uzavřou. Úkol zůstane navržený za ${String(score)} b.`,
    /** A parent's no on a chore's price change (#232): the parents' offer stays in flight. */
    turnDownChangeHint: (score: number, offer: number) =>
      `Všechny nabídky se uzavřou. Dál platí ${String(score)} b, nabídka ${String(offer)} b zůstává.`,
    /** A turn-down on a stale screen: a bid came in meanwhile. */
    turnDownChanged: 'Mezitím přišla nová nabídka. Podívej se na ni.',
    toast: {
      sent: 'Nabídka odeslána',
      agreed: 'Domluveno',
      agreedMine: 'Domluveno, úkol je tvůj',
      withdrawn: 'Nabídka stažena',
      turnedDown: 'Nabídky odmítnuty',
    },
  },
  /** Reopening bidding on a free one-time task (#212, spec §5.2). Bidding words reuse `bids`. */
  rebid: {
    reopen: 'Vyjednat novou cenu',
    reopenHint: (score: number) =>
      `Dokud se nedomluvíte, platí ${String(score)} b. Kdo úkol mezitím vezme, vyjednávání ukončí.`,
    approveHint: (score: number) => `Platí nová cena ${String(score)} b. Úkol zůstane volný.`,
    /** Header line in a round with a parent's counter: "Táta nabízí 16 b". */
    offer: (name: string, score: number) => `${name} nabízí ${String(score)} b`,
    turnDownHint: (score: number) => `Všechny nabídky se uzavřou. Dál platí ${String(score)} b.`,
    noEntries: 'Zatím žádná nabídka.',
    toast: { reopened: 'Vyjednávání otevřeno' },
  },
  /**
   * Score change of an agreed recurring template (spec §5.1): its price page and ways in. The
   * stepper, send button and hints reuse `bids`.
   */
  templatePrice: {
    history: 'Historie ceny',
    noHistory: 'Zatím beze změny ceny.',
    now: (score: number) => `Platí ${String(score)} b.`,
    /** A proposed chore's page (#205): the score is not agreed yet. */
    proposed: (score: number) => `Navržená cena: ${String(score)} b.`,
    startsWhenAll: 'Začne platit, až souhlasí všichni.',
    futureOnly: 'Nová cena platí jen pro nově vzniklé úkoly.',
    /** A brother's Domů: agreed templates, each with "Jiná cena" (until Zapsat #38). */
    recurring: 'Opakované úkoly',
    change: 'Změnit cenu',
    acceptOffer: (score: number) => `Přijmout ${String(score)}`,
    acceptBid: (score: number, names: string) => `Přijmout ${String(score)} (${names})`,
    /** Under every accept: only instances made later take the new score (§5.1). */
    acceptHint: 'Nové úkoly budou za tolik bodů.',
    /** A proposed chore's first price (#209): its page header, and under every yes. */
    proposedNow: (score: number) => `Návrh: ${String(score)} b.`,
    firstAgreeHint: (score: number) => `Úkol začne platit za ${String(score)} b.`,
  },
  /** Reserve, release, done, approve, reject (spec §5.4–§5.5). */
  work: {
    mine: 'Moje',
    free: 'Volné',
    toApprove: 'Ke schválení',
    reserve: 'Rezervovat',
    /** Over Rezervovat on a free task's page (#195, mockup TReserve). */
    reserveHint: 'Uděláš to později? Zarezervuj si to. Pak to za body nemůže udělat nikdo jiný.',
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
      /** `reopenBidding` on: an open task's price changes through a new round (#212). */
      biddingInstead: 'Cenu volného úkolu teď změníš novým vyjednáváním.',
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
    bidWithdrawn: 'nabídka stažena',
    bidsTurnedDown: 'nabídky odmítnuty',
    biddingReopened: 'nové vyjednávání o ceně',
    biddingClosed: 'vyjednávání skončilo',
    /** A divider in Historie once a price was reopened (#212): "2. vyjednávání o ceně". */
    round: (n: number) => `${String(n)}. vyjednávání o ceně`,
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
    /** Made by the schedule (#39), no person. */
    scheduledCreated: (n: number) => `přidáno podle rozvrhu za ${String(n)} b`,
    /** Its grace window ended with nobody done (#39). */
    expired: 'prošlo',
    /** A description (#207): set at once, or proposed and answered. */
    descriptionChanged: 'nový popis',
    descriptionProposed: 'návrh nového popisu',
    descriptionApproved: 'souhlas s novým popisem',
    descriptionDeclined: 'nesouhlas s novým popisem',
    descriptionWithdrawn: 'návrh popisu stažen',
    descriptionDiscarded: 'návrh popisu propadl',
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
    /** Before the running week's last day (#211): the week runs, settling waits for that day. */
    notYet: 'Týden ještě běží',
    runsUntil: (end: string) => `Týden běží do ${end}.`,
    settleOnLastDay: 'Vyúčtovat půjde až v poslední den týdne.',
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
    rejectedClosed: 'Bez bodů.',
    /** Point adjustments on Týden (#48): the row names, then the reason under it. */
    adjustment: 'Úprava od správce',
    correctionRow: 'Oprava týdne',
    fromWeek: (week: string) => `Z opravy týdne ${week}`,
    waiting: 'Čeká na schůzku',
    counted: 'Započteno',
    adjustmentPoints: (n: number) => signedPoints(n),
    /** Under a corrected settled week on Historie. */
    correctedLine: (now: string, was: string, diff: number, date: string, reason: string) =>
      `Opraveno na úroveň ${now} (původně ${was}): ${signedPoints(diff)} · ${date} · ${reason}`,
  },
  /** Disputes on locked items (#46, spec §5.11, UI doc §7.1 TDispute). Chip text: `state.disputed`. */
  /** What done means on a task or chore (#207, spec §4). */
  description: {
    label: 'Popis',
    none: 'Bez popisu',
    add: 'Přidat popis',
    edit: 'Upravit popis',
    sheetTitle: 'Popis úkolu',
    field: 'Co znamená hotovo',
    count: (n: number) => `${String(n)} / 1000`,
    save: 'Uložit',
    saving: 'Ukládám…',
    newField: 'Popis (nepovinné)',
    newHint: 'Napiš, co přesně znamená hotovo. Kluci to uvidí, než souhlasí.',
    resetWarn: 'Kdo už souhlasil, bude muset souhlasit znovu.',
    waitWarn: 'Kluci nový popis nejdřív odsouhlasí.',
    waitingTitle: 'Nový popis čeká na souhlas',
    waitingRemove: 'Návrh: popis odebrat',
    /** What a waiting change changes (Jakub 2026-11-26): the hint and screen-reader words. */
    diffHint: 'Podtržené přibylo, přeškrtnuté ubylo.',
    diffAdded: 'přibylo:',
    diffRemoved: 'ubylo:',
    waitingFor: (names: string) => `Čeká na: ${names}`,
    agree: 'Souhlasím s popisem',
    decline: 'Nesouhlasím',
    takeBack: 'Vzít zpět',
    homeRow: 'Nový popis k odsouhlasení',
    hasIcon: 'Má popis',
    readAndAgree: 'Přečíst a souhlasit',
    toast: {
      applied: 'Popis uložen.',
      waiting: 'Popis čeká na souhlas kluků.',
      withdrawn: 'Návrh popisu vzat zpět.',
      agreed: 'Nový popis platí.',
      declined: 'Zůstává starý popis.',
    },
    errors: {
      description_too_long: 'Popis je delší než 1000 znaků.',
      description_frozen: 'Popis už nejde změnit.',
      not_changeable: 'Tady popis měnit nemůžeš.',
      same_description: 'Popis je stejný jako teď.',
      no_change: 'Návrh už neplatí. Podívej se znovu.',
      not_involved: 'Tenhle návrh neodsouhlasuješ ty.',
    },
  },
  disputes: {
    action: 'Rozporovat',
    actionFor: (what: string, name: string) => `Rozporovat: ${what} – ${name}`,
    /** An open dispute's chip on its item. */
    waiting: 'Sporné · čeká na správce',
    /** Týden → Historie: the disputes the viewer is involved in. */
    list: 'Rozporováno',
    reasonLabel: 'Proč?',
    note: 'Spor rozhodne správce. Do té doby se body ani stav nemění. Rodiče spor uvidí. Vzít zpět ho nejde.',
    send: 'Poslat správci',
    sending: 'Posílám…',
    sent: 'Odesláno správci.',
    kept: (note: string) => `Správce nechal beze změny: ${note}`,
    fixed: (note: string) => `Správce opravil: ${note}`,
    /** An adjustment's points with their sign: `+5 bodů`, `−3 body`. */
    adjustmentValue: (n: number) => (n > 0 ? `+${formatPoints(n)}` : `−${formatPoints(-n)}`),
    openedBy: (name: string, reason: string) => `${name}: ${reason}`,
    what: {
      task_score: 'Body za úkol',
      template_score: 'Body za opakovaný úkol',
      completion: 'Potvrzené splnění',
      rejection: 'Zamítnuté splnění',
      settlement: 'Vyúčtování týdne',
      adjustment: 'Úprava bodů',
    },
    errors: {
      not_locked: 'Tohle se teď rozporovat nedá.',
      dispute_open: 'Už je rozporováno.',
      reason_required: 'Napiš, proč.',
      not_found: 'Tohle už neexistuje.',
      not_a_party: 'Rozporovat můžou jen děti a rodiče.',
      feature_off: 'Rozporování je vypnuté.',
      generic: 'Nepovedlo se. Zkus to znovu.',
    },
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
    /** Výchozí týden on Správa (#47, spec §5.8). Level labels: `cs.meeting.level`. */
    defaults: {
      title: 'Výchozí týden',
      length: 'Délka',
      days: (n: number) => `${String(n)} dní`,
      shorter: 'Kratší',
      longer: 'Delší',
      less: (field: string) => `Méně: ${field}`,
      more: (field: string) => `Více: ${field}`,
      cutoff: 'Konec',
      weekday: 'Den',
      time: 'Čas',
      /** Full day names, Sunday first like `Weekday`; the list shows them Monday first. */
      weekdayNames: ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'],
      hint: 'Platí od dalšího týdne, který ještě nezačal. Běžící týden se nemění.',
      failed: 'Uložení se nepovedlo. Zkus to znovu.',
      invalidSettings: 'Takhle to nejde: horní hranice musí být aspoň spodní.',
    },
    /** Sporné on Správa (#47, UI doc §7.5 ADisputes): open disputes, kept with a note. */
    disputes: {
      title: (n: number) => `Sporné (${String(n)})`,
      empty: 'Žádný otevřený rozpor.',
      /** Short: shares a row with #48's Opravit at 360 px. */
      keep: 'Ponechat',
      keepFor: (what: string, name: string) => `Ponechat: ${what} – ${name}`,
      /** Who opened the dispute, ahead of the date (the row names whose item it is above). */
      openedBy: (name: string) => `${name} rozporuje`,
      dialogTitle: 'Ponechat beze změny',
      dialogText: 'Rozpor se uzavře, body ani stav se nezmění. Vzít zpět to nejde.',
      noteLabel: 'Poznámka pro rodinu',
      noteHint: 'Uvidí ji rodiče i děti, kterých se to týká.',
      confirm: 'Ponechat',
      saving: 'Ukládám…',
      done: 'Hotovo. Rodina uvidí poznámku.',
      loadError: 'Sporné se nepodařilo načíst.',
      retry: 'Zkusit znovu',
      errors: {
        not_open: 'Tenhle rozpor už je vyřízený.',
        value_changed: 'Mezitím se to změnilo. Podívej se znovu.',
        note_required: 'Napiš poznámku.',
        not_found: 'Tenhle rozpor už neexistuje.',
      },
      /** Beside Ponechat on a Sporné row (#48): the fix sheet for this dispute. */
      fix: 'Opravit',
      fixFor: (what: string, name: string) => `Opravit: ${what} – ${name}`,
    },
    /** Opravy bodů on Správa and the fix sheet (#48, UI doc §7.5 AFix, spec §5.9). */
    fix: {
      title: 'Opravy bodů',
      adjust: 'Upravit body',
      correct: 'Opravit týden',
      sheetAdjust: 'Upravit body',
      sheetCorrect: 'Opravit týden',
      add: 'Přidat',
      remove: 'Ubrat',
      who: 'Kdo',
      week: 'Týden',
      level: 'Úroveň',
      points: 'Body',
      reason: 'Důvod',
      corrected: 'opraveno',
      /** Points mode: his confirmed total now and after the fix. */
      preview: (name: string, before: number, after: number) =>
        `${name}: ${String(before)} → ${after < 0 ? `−${String(-after)}` : String(after)} b.`,
      belowZero: 'Tolik bodů nemá.',
      /** Week mode: what the correction moves on today's total (current deduction − new). */
      difference: (n: number) => `Rozdíl: ${signedPoints(n)} k dnešku`,
      hint: 'Důvod uvidí rodina u úpravy.',
      hintDispute: 'Důvod uvidí rodina i jako odpověď na rozpor.',
      sendAdd: (n: number, name: string) => `Přidat ${String(n)} b. – ${name}`,
      sendRemove: (n: number, name: string) => `Ubrat ${String(n)} b. – ${name}`,
      sendCorrect: (level: string, name: string) => `Opravit: ${level} – ${name}`,
      saving: 'Ukládám…',
      done: 'Opraveno.',
      noTakers: 'Nikdo tu nesbírá body.',
      noWeeks: 'Zatím žádný uzavřený týden.',
      loadError: 'Opravy se nenačetly.',
      retry: 'Zkusit znovu',
      errors: {
        week_waiting: 'Týden čeká na schůzku. Body teď jde jen přidat.',
        would_go_negative: 'Tolik bodů nemá. Celkem by šel pod nulu.',
        no_change: 'Týden už tuhle úroveň má.',
        reason_required: 'Napiš důvod.',
      },
    },
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
  /** Proposals for next week and the default week (#43, spec §5.8, UI doc §7.2 Period, GDefaults). */
  proposals: {
    title: 'Příští týden',
    defaultsTitle: 'Výchozí týden',
    thisWeek: 'Tento týden',
    locked: 'Zamčeno',
    nextSection: 'Návrh na příští týden',
    defaultsSection: 'Návrh výchozího týdne',
    proposedBy: (name: string) => `Navrhuje: ${name}`,
    agreedChip: 'Dohodnuto',
    validFrom: (when: string) => `Platí od ${when}`,
    whoAgreed: 'Kdo souhlasí',
    waiting: 'čeká',
    agreedMark: 'souhlasí',
    /** Czech plural: 1 den, 2–4 dny, 5+ dní. */
    days: (n: number) => `${String(n)} ${n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní'}`,
    length: 'Délka',
    end: 'Konec',
    lower: 'Spodní hranice',
    upper: 'Horní hranice',
    levels: (lower: number, upper: number) =>
      `spodní hranice ${String(lower)} · horní ${String(upper)}`,
    weekdayTime: (weekday: string, time: string) => `${weekday} ${time}`,
    note: (deadline: string, length: string, lower: number, upper: number) =>
      `Změna platí, jen když souhlasí všichni kluci a jeden rodič do ${deadline}. Jinak bude příští týden ${length}, spodní hranice ${String(lower)}, horní ${String(upper)}.`,
    approve: 'Souhlasím',
    reject: 'Nesouhlasím',
    withdraw: 'Stáhnout návrh',
    sending: 'Posílám…',
    proposeOther: 'Navrhnout jinak',
    proposeAll: 'Navrhnout všem',
    cancel: 'Zrušit',
    shorter: 'Kratší',
    longer: 'Delší',
    endLine: (when: string) => `Konec: ${when}`,
    tooLong: 'Takhle dlouhý týden nejde, zkrať ho.',
    noWeek: 'Týden ještě nezačal.',
    defaultsLink: 'Výchozí týden (rodiče)',
    /** Výchozí týden form (GDefaults): the stored default week above the form. */
    nowLine: (length: string, end: string, lower: number, upper: number) =>
      `Nyní: ${length} · konec ${end} · spodní hranice ${String(lower)}, horní ${String(upper)}`,
    defaultsHint:
      'Pošle se jako návrh. Začne platit, až souhlasí všichni kluci a jeden rodič. Běžící týden se nemění.',
    sent: 'Návrh odeslán',
    done: { approve: 'Souhlas odeslán', reject: 'Návrh skončil', withdraw: 'Návrh stažen' },
    confirm: {
      reject: {
        title: 'Nesouhlasit s návrhem?',
        body: 'Návrh tím skončí pro všechny. Kdo chce změnu, musí navrhnout znovu.',
        yes: 'Nesouhlasím',
      },
      withdraw: {
        title: 'Stáhnout návrh?',
        body: 'Návrh zmizí. Příští týden bude podle výchozího týdne.',
        bodyDefaults: 'Návrh zmizí. Výchozí týden zůstane, jak je.',
        yes: 'Stáhnout',
      },
      back: 'Zpět',
    },
    /** Týden card, Domů rows, meeting step 3 (Task 5). */
    entry: {
      card: 'Příští týden',
      pending: 'Návrh čeká',
      periodRow: 'Návrh na příští týden',
      defaultsRow: 'Návrh výchozího týdne',
      open: 'Otevřít',
      otherLevels: 'Jiné hranice',
    },
    errors: {
      alreadyStarted: 'Příští týden už začal, návrh už neplatí.',
      pending: 'Návrh už existuje. Obnov stránku.',
      alreadyAgreed: 'Změna už je dohodnutá.',
      invalid: 'Takhle to nejde: zkontroluj délku a hranice.',
      gone: 'Návrh už neplatí. Obnov stránku.',
      forbidden: 'Na tohle nemáš právo.',
      noWeek: 'Týden ještě nezačal.',
      failed: 'Nepovedlo se. Zkus to znovu.',
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
/** Points with their sign, short: `+5 b.`, `−3 b.`, `0 b.`. */
export function signedPoints(n: number): string {
  if (n > 0) return `+${String(n)} b.`
  if (n < 0) return `−${String(-n)} b.`
  return '0 b.'
}

export function formatPoints(n: number): string {
  return `${n} ${plural(n, pointWords)}`
}
