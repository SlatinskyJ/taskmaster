# Taskmaster — UI Design

- **Date:** 2026-11-16
- **Status:** Theme and palette chosen by Jakub; screens are mockups for review
- **Rules:** the main spec (`2026-11-16-taskmaster-design.md`) wins on behaviour. This doc covers look, feel, and screen structure (spec section 7). Items marked **[call]** are Claude's defaults that Jakub may overturn.

Mockups (clickable, phone size):
- Screens, all 25 flows: https://claude.ai/artifact/EGVWwxgLQC5cAbQ9XR185x
- Theme with light/dark and the effect speed slider: https://claude.ai/artifact/EgUoJL8c21ravun7AAqPYx
- Palette comparison: https://claude.ai/artifact/XAzd5Cp1Wj9uuonnWqUVrY

The HTML sources are in the project files under `/ui-design/`. They are references, not code to copy.

---

## 1. Direction
- **Theme "Hřiště"** (Jakub): playful, gamified, but clean. Colour carries meaning (state, points); everything else stays calm.
- **Palette "Pastelky"** (Jakub): warm cream background, coral and violet accents, colours that work as a team rather than all at full volume.
- **Light and dark** (Jakub), following the system, with a manual switch in the profile.
- Big tap targets (at least 44 px), few words, numbers large. A 13-year-old must manage it one-handed.

## 2. Tokens

### 2.1 Base (Pastelky)
| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFF5EE` | `#1D1524` | Page |
| `surface` | `#FFFFFF` | `#2A1F33` | Cards, drawers |
| `ink` | `#2B1F2E` | `#FFF1E8` | Text |
| `muted` | `#6E6270` | `#B8AAB8` **[call]** | Secondary text |
| `accent` | `#F2545B` | `#FF6A70` | Coral: brand, avatars, highlights |
| `accent-strong` | `#D93A42` | `#FF6A70` | Primary buttons (white text in light mode, for contrast) |
| `accent2` | `#9B5DE5` | `#B282F5` | Violet: proposals, levels |
| `ok` | `#23813D` | `#57D277` | Approve buttons |
| `track` | `#F7E3D7` | `#3A2D45` | Progress track, chip backgrounds |
| `shadow` | `#F2DDD0` | `#130D19` | The 2 px "sticker" shadow |
| `tint` | `#FEEEEF` | `#33203A` **[call]** | Score card background |

### 2.2 States
Each state has a dot colour and a text colour. Text colours are darkened to reach 4.5:1 on white.

| State (spec 5.6) | Czech label | Dot (light) | Text (light) | Dot (dark) |
|---|---|---|---|---|
| proposed | Návrh | `#9B5DE5` | `#7A3FC4` | `#B98AF7` |
| negotiating | Vyjednává se | `#E84FA8` | `#B8287A` | `#FF74C0` |
| open | Volné | `#1E9BE0` | `#0B6FA6` | `#4DB8F5` |
| reserved | Rezervováno | `#0FAE9E` | `#08786D` | `#33CDBB` |
| done, pending | Čeká na potvrzení | `#F2A900` | `#8A5E00` | `#FFC53D` |
| confirmed | Hotovo | `#36A853` | `#21793A` | `#57D277` |
| expired | Prošlo | `#A39A92` | `#6E655E` | `#8A8193` |
| cancelled | Zrušeno | `#C9C0B8` | `#7A716A` | `#5F5668` |
| rejected (display only) | Zamítnuto | `#D93A42` | `#B8323A` | `#FF6A70` |
| disputed (spec 5.11) | Sporné | `#F26B1D` | `#A3410F` | `#FF8A47` **[call]** |

State is shown in three places, the same way everywhere: a **chip** (rounded pill, dot + label, background 15 % of the dot colour), a **4 px stripe** on the left edge of a row, and the points colour where it applies.

### 2.3 Type, shape, spacing
- **Fredoka** (500–700) for headings and all numbers (tabular figures). **Nunito** (500–800) for body text.
- Sizes: page title 26 px, row name 15 px, meta 13 px, chip 11 px, big points 40 px+.
- Radius 16 px for cards, 12 px for buttons, full pill for chips and avatars.
- Shadow: a flat `0 2px 0 shadow`, no blur. No gradients except the pending stripes.
- Page gutter 16 px, card padding 14 px, gap 12–14 px. Layout is designed at 390 px wide and must work from 360 px.

## 3. Points bar
- Track in `track`. Confirmed points fill solid in `confirmed`; pending points continue after them in **diagonal stripes** of the pending colour, so "not yet counted" is visible at a glance.
- Two ticks mark the lower and upper levels with small labels ("spodní 50", "horní 100"). **[call]** The scale runs to 120 % of the upper level.
- Below the bar: `45 ✔ + 15 ⏳` in Fredoka.

## 4. Effects
- **Done** (taker taps Hotovo): confetti burst plus a floating "+N" in the pending colour.
- **Confirmed** (giver approves): a floating "+N" in green, and the bar grows.
- **Level reached** (confirmed points cross a level): a toast ("Spodní hranice!") and a short glow on the bar.
- **Speed (Jakub, 2026-11-16):** 1.7× slower than the first draft, which was too fast. Confetti lasts about 2.4 s and the "+N" float about 1.9 s.
- `prefers-reduced-motion` and the profile's "Efekty" switch turn effects into a plain colour change.
- Library: `canvas-confetti` (spec 11). Keyframes live in one small CSS file.

## 5. Components (shadcn/ui, restyled)
| Need | shadcn component | Notes |
|---|---|---|
| Buttons | Button | Variants: primary (coral), ok (green), no (white with red outline), ghost (white with outline), icon 44 px |
| Cards, rows | Card | Row = card line with the left state stripe |
| State | Badge | The chip from 2.2 |
| Points bar | Progress | Extended with the pending stripes and level ticks |
| Task actions, reasons, disputes | Drawer | Bottom sheet on phones |
| Confirmations | Dialog | Only for actions that can't be undone (cancel task, settle) |
| Tabs | Tabs | E.g. Tento týden / Historie |
| Feedback | Sonner | Toasts for "saved", "sent", level reached |
| Forms | Input, Textarea, Select | Steppers (− value +) for numbers instead of typing |
| Tablet PIN (stretch) | Input OTP | |

All shadcn CSS variables map to the tokens in section 2, so nothing keeps the default neutral look.

## 6. Navigation
- **Taker:** bottom bar Domů / Zapsat / Týden. The avatar opens the profile.
- **Giver:** bottom bar Domů / Úkoly / Schůzka / Týden.
- **Admin:** one Správa screen, no bottom bar.
- **[call]** Anything waiting for the current user ("Čeká na tebe") is always at the top of Domů.

## 7. Screen inventory
The screens mockup has one row per role. Names are the artboard names.

### 7.1 Taker
| Screen | What it does | Spec |
|---|---|---|
| Main (Domů) | Points bar, waiting for me, my reservations, open tasks, Hotovo buttons | 5.4–5.7, 7 |
| TTask | Task detail with the bid thread: accept, counter, reserve, done, release | 5.2, 5.4, 5.5 |
| TLog | Log an unprompted chore from template tiles | 5.3, 5.5 |
| TReserve | Reservation states: open, mine, pending, someone else's | 5.4 |
| TApprove | Approve a new template, a new one-time task, or a price change | 5.1, 5.2 |
| TWeek | This week and history; "Rozporovat" on locked items | 5.8, 5.9, 5.11 |
| Plan | Week plan table, chores × days, landscape; tap a free cell to reserve (givers see it too and open a copy from it) | 5.12 |
| TDispute | Dispute drawer: what, current value, reason | 5.11 |

### 7.2 Giver
| Screen | What it does | Spec |
|---|---|---|
| GHome | Completions to approve, bids to answer, the week at a glance | 5.5, 7 |
| GCreate | One-time task or recurring template: score, days, deadline | 5.1–5.3 |
| GTasks | All tasks by state, "+ Teď" creates an instance on demand | 5.3 |
| GTask | Task detail: change price, release, did it myself, cancel, history | 5.2, 5.4–5.6 |
| GBid | Reply to a bid: accept or counter | 5.2 |
| GReject | Reject a completion with a reason | 5.5 |
| Period | This week (locked) and the proposal for next week, with who agreed | 5.8 |
| GDefaults | Propose new default week settings; applies once all takers and one giver agree | 5.8 |

### 7.3 Meeting (giver)
| Screen | What it does | Spec |
|---|---|---|
| M1Pending | Approve or reject everything pending before the cutoff; step 2 stays locked until it is empty | 5.9 step 1 |
| M2Settle | Per taker: total, level reached, points deducted, carry-over; confirm | 5.9 step 2 |
| M3Plan | Open tasks and the week plan table for the coming week, optional proposal for the week after | 5.9 step 3, 5.12 |

### 7.4 Login and profile
| Screen | What it does | Spec |
|---|---|---|
| Login | Passkey button first, password as a fallback | 6, 11 |
| Passkey | After the first password login: offer "Přihlásit otiskem / obličejem" | 11 |
| Tablet (stretch) | Pick a name, enter a PIN | 6 |
| Profile | Light / dark / auto, effects on/off, log out | — |

### 7.5 Admin
| Screen | What it does | Spec |
|---|---|---|
| ASettings | Open disputes, default week, people (add, rename, role, deactivate, reset password), CSV export of the change log | 3, 5.8, 5.10, 6 |
| ADisputes | Each open dispute: who, what, current value, reason; keep or correct | 5.11 |
| AFix | Settlement correction or point adjustment; reason required | 5.9 |

## 8. Known gaps in the mockups
- The tablet screen is drawn at phone size.
- Dispute entry points are drawn on the taker side only; the same "Rozporovat" action belongs on every locked item for givers too.
- Empty states, errors, and loading are not drawn yet. **[call]** Empty states get one friendly line and, where it fits, the main action.
- Real names are placeholders (Tomáš, Ondra).
