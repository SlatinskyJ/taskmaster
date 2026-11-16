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
- **Accessibility:** contrast AA, visible focus, labels on inputs, `prefers-reduced-motion` respected for confetti and animations.
- **Mockups:** matches `/ui-design/` mockups and the PR brief screenshots.

Use the PR brief's screenshots. If they're missing for a changed screen, that is a `should-fix`.

## Not your lane

| Concern | Judge |
| --- | --- |
| Whether the button does the right §5 thing | Rules |
| Component code structure | Architecture |

## Common mistakes

- Taste changes ("I'd use a different shade") as should-fix. That is a `nit`.
- Re-designing a screen the PR didn't touch. That is `pre-existing`.
