# Rename the demo kids to Anička and Béďa: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#353 Rename the demo kids to Anička and Béďa](https://github.com/SlatinskyJ/taskmaster/issues/353), part of epic #322.

**Goal:** The demo family's takers are shown as Anička (login `starsi`) and Béďa (login `mladsi`), and every Czech line that assumes the takers are boys reads right for a girl too.

**Architecture:** Data and copy only. The seed's display names and the demo button labels change; sixteen values in `src/lib/strings.ts` get gender-neutral wording; tests that look for the old text follow. A unit test pins that no boy-only wording comes back.

**Tech Stack:** TypeScript, Vitest, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-27-demo-environment-design.md` (line 20 names the demo buttons). The main spec `2026-11-16-taskmaster-design.md` speaks of "the brothers" in English as a description of the real family; it states no Czech wording, so it does not change.

**Size:** about 25 changed lines outside tests (16 strings, 4 seed and label values, 1 spec line, a few comments). Tests: about 150 lines, mostly e2e text that follows the new names.

## Global Constraints

- Jakub's decision (2026-11-28, decision card in the project thread): names Anička and Béďa; the boy-only lines become neutral **for everyone**, the real family included.
- Logins stay `starsi` and `mladsi`. No username, id or `DemoLogin` key changes (`src/lib/demoAccounts.ts` is untouched).
- Czech UI text only in `src/lib/strings.ts` (CLAUDE.md).
- Which kid is which: `starsi` → **Anička**, `mladsi` → **Béďa** (the order Jakub named them).
- Unit-test fixtures (`src/server/tasks/testing.ts`, `src/components/**/fixtures.ts`) keep `Starší` / `Mladší`: they are test data, not the demo, and changing them would churn hundreds of assertions for nothing.
- Generic pronouns that standard Czech uses for any person stay: "někdo jiný", "Kdo už souhlasil", "dotyčnému".
- Name declension (`pro ${name}`, `Čeká se na: ${name}`) is out of scope: names are shown in the nominative for every user today, the real family too. Not this issue.

## The wording (decided here; the brief shows it to Jakub)

| Key (`cs.`…) | Now | New |
| --- | --- | --- |
| `tasks.proposeHint` | Úkol bude volný, až cenu schválí jeden z kluků. | Úkol bude volný, až cenu schválí jedno z dětí. |
| `log.intro` | Udělal jsi něco sám od sebe? Zapiš to. | Máš hotové něco, co nikdo nezadal? Zapiš to. |
| `templates.proposeHint` | Začne platit, až cenu schválí jeden z kluků. | Začne platit, až cenu schválí jedno z dětí. |
| `work.reservedBy` (+ name) | Rezervoval Anička | Rezervace: Anička |
| `work.doneBy` (+ name) | Udělal Anička | Hotovo: Anička |
| `…needsOpen` | Platí, až souhlasí rodič i jeden z kluků | Platí, až souhlasí rodič i jedno z dětí |
| `…waitingOnTakers` | Čeká na kluky | Čeká na děti |
| `…planHint` | Kluci si dny rezervují v Týdnu na svých telefonech. Pak klepni na Obnovit. | Děti si dny rezervují v Týdnu na svých telefonech. Pak klepni na Obnovit. |
| `…newHint` (description) | … Kluci to uvidí, než souhlasí. | … Děti to uvidí, než souhlasí. |
| `…waitWarn` (description) | Kluci nový popis nejdřív odsouhlasí. | Děti nový popis nejdřív odsouhlasí. |
| `…waiting` (description) | Popis čeká na souhlas kluků. | Popis čeká na souhlas dětí. |
| `…would_go_negative` | Tolik bodů nemá. Celkem by šel pod nulu. | Tolik bodů nemá. Celkem by to bylo pod nulou. |
| feature switch hint (`…hint`, line ~910) | „Nechci“ u kluků a odmítnutí rodičem | „Nechci“ od dětí a odmítnutí rodičem |
| next-week note (line ~1013) | … souhlasí všichni kluci a jeden rodič do … | … souhlasí všechny děti a jeden rodič do … |
| next-week hint (line ~1031) | … souhlasí všichni kluci a jeden rodič. … | … souhlasí všechny děti a jeden rodič. … |
| `points.takersTitle` | Kluci tento týden | Děti tento týden |

"Rezervace:" and "Hotovo:" follow the history's existing "rezervace: <name>" form (`cs.history.agreedReserved`). Line numbers are from `main` at d09a424; find each value by its text.

## Review Focus

1. A boy-only word left in a string nobody opened (new strings after rebase too) → the guard test in Task 1 fails on it.
2. `Hotovo:` meta line next to a "Hotovo" button on the same card could read as a button label → check the approve card screenshot (code phase) shows it as the grey meta line under the title.
3. The demo login buttons and `/dev/multi` frames show Anička / Béďa (labels come from `cs.demo.users`, after #348 lands) → e2e `demo`/`multi` suites assert the new names.
4. A long name in a two-column button grid at 360 px: "Anička" and "Béďa" are shorter than "Starší" / "Mladší", so no new wrap risk; nothing to add.
5. The demo seed's names reach every preview (shared `demo` seed) → e2e suites that log in as `starsi` and check a name follow.

---

### Task 1: Neutral wording, with a guard test

**Files:**
- Modify: `src/lib/strings.ts` (the 16 values above; update the doc comments that quote "Rezervoval Starší" / "Udělal Starší" to the new form)
- Create: `src/lib/strings.neutral.test.ts`
- Modify: unit tests that quote the old text: `src/components/descriptions/descriptionCalls.test.ts`, `src/components/meeting/meeting.test.tsx`, `src/components/points/takersPoints.test.tsx`, `src/components/proposals/nextWeek.test.tsx`, `src/components/tasks/homePage.test.tsx`, `src/components/tasks/taskView.test.ts`, `src/components/tasks/tasks.test.tsx`, `src/components/tasks/tasksPages.test.tsx` (find more with `git grep -nE "kluk|Kluci|kluc|Rezervoval|Udělal" -- src e2e`)

- [ ] **Step 1: Write the failing guard test** `src/lib/strings.neutral.test.ts`:

```ts
// Jakub 2026-11-28 (#353): takers can be girls; no Czech line assumes boys.
// No \b after a Czech letter: JS \b knows ASCII letters only.
const BOY_ONLY = [/\bkluk/i, /\bkluc/i, /\brezervoval(?![a-zěščřžýáíéůú])/i, /\budělal(?![a-zěščřžýáíéůú])/i, /sám od sebe/i, /by šel(?![a-zěščřžýáíéůú])/i]

it('no Czech string assumes the takers are boys', () => {
  const found = allStrings(cs).filter((s) => BOY_ONLY.some((re) => re.test(s)))
  expect(found).toEqual([])
})
```

`allStrings(value): string[]` walks `cs` recursively: strings as they are, arrays element-wise, and each function called with sample arguments (numbers `1`, strings `'x'`, booleans `true`; use `fn.length` and pass `1` for every parameter, then `'x'` — whichever returns a string; for a function with a boolean or plural branch, also call it with `false` and with `2` and `5` so each branch's text is checked). A function that throws on every sample, or returns no string, **fails the test** (it is listed by its key path) instead of being skipped. Keep the walker in the test file.

- [ ] **Step 2:** `pnpm test src/lib/strings.neutral.test.ts` → FAIL listing the old lines.
- [ ] **Step 3:** Change the 16 values to the "New" column, word for word.
- [ ] **Step 4:** Update the unit tests that quoted the old text to the new text (same assertion, new words; never drop one).
- [ ] **Step 5:** `pnpm test` → PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 6: Commit** `Neutral Czech for takers: no line assumes boys (#353)`.

### Task 2: Demo names Anička and Béďa

**Files:**
- Modify: `src/server/demo/seed.ts` (`DEMO_USERS`: `starsi` → `displayName: 'Anička'`, `mladsi` → `displayName: 'Béďa'`)
- Modify: `src/lib/strings.ts` (`cs.demo.users` / `demoUsers`: `starsi: 'Anička'`, `mladsi: 'Béďa'`, wherever the branch has it after rebasing on #348)
- Modify: `src/server/demo/seed.test.ts` (and any demo test that reads the names)
- Modify: `docs/superpowers/specs/2026-11-27-demo-environment-design.md` line 20: `Admin, Táta, Anička, Béďa` (Jakub's OK: 2026-11-28 decision)
- Modify: `CLAUDE.md` demo-data line: "`admin`, `tata`, `starsi` (Anička), `mladsi` (Béďa)"
- Modify: every e2e spec that looks for `Starší` / `Mladší` / old wording on screen (`git grep -nE "Starší|Mladší|kluky|Rezervoval|Udělal" -- e2e`)

- [ ] **Step 1:** In `seed.test.ts`, assert the seeded users' display names: `[['admin','Admin'],['tata','Táta'],['starsi','Anička'],['mladsi','Béďa']]`, and that for every `DEMO_USERS` entry the button label `cs.demo.users[username]` (and, if the branch still has it separately, `cs.dev.users[username]`) equals its `displayName`, so the labels and the seed can't drift apart. Run → FAIL.
- [ ] **Step 2:** Change `DEMO_USERS` and the labels. Run → PASS.
- [ ] **Step 3:** Update e2e text: `Starší` → `Anička`, `Mladší` → `Béďa`, `Čeká na kluky` → `Čeká na děti`, and any `Rezervoval` / `Udělal` meta text to the new form. Logins (`starsi`, `mladsi`) stay. Keep `keyboard-live.spec.ts`'s long task title as it is ("pokoj kluků" is a task title, not app copy).
- [ ] **Step 4:** Run the e2e suites that changed (`pnpm exec playwright test <files> --trace off`) → PASS.
- [ ] **Step 5:** Spec line and CLAUDE.md line.
- [ ] **Step 6: Commit** `Demo kids are Anička and Béďa (#353)`.

### Task 3: Verify

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` → all pass.
- [ ] `git grep -nE "Starší|Mladší" -- e2e src/server/demo/seed.ts src/lib/strings.ts` prints only doc comments (the comment examples in `strings.ts` may be updated to the new names too).
