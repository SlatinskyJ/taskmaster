---
name: judge-ux
description: Use when acting as the UX judge in a Taskmaster pull request review round, or when a PR changes screens, components, Czech labels, styles or the Hřiště theme
---

# UX judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** can a 13-year-old use this on a phone without help, in Czech, and does it look like Hřiště?

## Check

- **Phone first:** works at 360 px width with no horizontal scroll. Tap targets ≥ 44 px. Main action within thumb reach.
- **Few words:** labels short and in Czech, consistent with the strings module. No English in the UI.
- **States visible:** confirmed vs pending points look clearly different. Every list has loading, empty and error states.
- **Theme:** Hřiště/Pastelky tokens from `@theme`, no raw hex. Light mode always; dark mode only when the theme or tokens changed.
- **Keyboard open:** with the phone keyboard up (about half the screen), the field being typed in is on screen, also when a sheet or dialog focuses it on open. The send button may sit under the keyboard if the page scrolls to it. The bottom sheet moves above the keyboard by itself; a centred dialog stays put, so a field in its lower half ends up under the keyboard. Text fields set `enterKeyHint`; number fields `inputMode`; names and logins `autoCapitalize="none"` where case matters. `autoFocus` does not open the iOS keyboard; do not rely on it.
- **Accessibility:** contrast AA, visible focus, labels on inputs, `prefers-reduced-motion` respected for confetti and animations.
- **Mockups:** each changed screen gives a person what its mockup gives (see Mockups).

## Screenshots (code rounds)

You don't run the app. You look at the builder's screenshots: the folder your prompt names (`Screenshots: <folder>`, 360 px wide, one file per screen and state) and the ones in the PR brief (the iPhone 15 Pro screen, 393×852, one screen per file).

1. **List first.** From the diff, write down every screen and state this PR adds or changes: each kind of row, each set of buttons on a row, each form and dialog, each empty and error state.
2. **Look at every file** in the folder (Read tool). Judge what the picture shows, not what the class names promise: a `truncate` in the code tells you text can be cut, the screenshot tells you whether a person can still read it. Look for text cut or broken in the middle of a word, something the code renders that is not on the picture (a chip label, a name, the line under the title), things on top of each other, a row whose buttons squeeze out its text.
3. **Hold the list against the folder.**

| What you see | Finding |
| --- | --- |
| Something a person needs to read or tap is cut, hidden or covered | `should-fix` on the line that lays it out. Name the file. `Failure: <who>, <screen> at 360 px → <what they cannot read or do> (<file>)` |
| A screen or state on your list has no 360 px screenshot, or there is no folder | `should-fix` on the line that renders it. `Failure: <screen, state> at 360 px → on no screenshot; nobody has seen whether <what has to fit there> fits`. `Fix: add a screenshot of <state>` |
| A form, sheet or dialog with a text field has no keyboard-open screenshot (`-keyboard-`), or on it the field being typed in sits under the keyboard, or the form has no case in `e2e/keyboard.spec.ts` | `should-fix` on the line that lays out the form. `Failure: <who>, <screen> with the keyboard open → <what they cannot see while typing>` |
| A row that shows a task name is shot only with short ones | the same finding: a row is checked with a long Czech task name (about 30 letters), or not at all |
| A value the code states exactly (`min-h-10` is 40 px; a contrast ratio from two tokens) | needs no screenshot; cite the line |

Round 2+: the builder takes new screenshots of what its fixes changed. A fix that changes a screen and comes with no new screenshot is `Still open: no screenshot of the fix`.

## Mockups

The UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` names every screen by its mockup in §7 (`Main`, `TTask`, `GHome`, …) and links the Screens artifact at its top. For each screen the PR changes, read its mockup: Artifact tool, action `read`, that link, `path: project/<Name>.dc.html`.

- The mockup is a reference, not a pixel target. A difference is a `should-fix` when a person loses something the mockup gives them: a state, an action, a piece of information. A difference in looks only is a `nit`.
- Name the mockup in the finding: `Spec: UI doc §7.2, mockup GHome`.
- UI doc §8 lists what the mockups don't draw (empty, error and loading states; real names). Their absence from a mockup is not a reason to leave them out of the screen.

## In a plan round

There is no rendered screen and no screenshot yet, so the Screenshots section does not apply. Judge what the plan decides: which screens and states exist, what each row and button says (the Czech strings are written in the plan), which state a person sees where, and whether that matches the UI doc and the mockups (see Mockups).

A finding only a rendered screen can confirm (a row fits at 360 px, contrast, tap size) is a `nit` in a plan round. Say what to look at once it is built.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether the button does the right §5 thing | Rules |
| Component code structure | Architecture |

## Common mistakes

- Taste changes ("I'd use a different shade") as should-fix. That is a `nit`.
- Re-designing a screen the PR didn't touch. That is `pre-existing`.
- Reading the classes and calling the row fine. Open the screenshot.
- Asking for a screenshot as a `nit`. An unseen changed screen is a `should-fix`.
