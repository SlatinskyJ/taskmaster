---
name: pr-brief
description: Use when a Taskmaster pull request is about to be marked ready for review, or when its review rounds finish and the PR brief for Jakub needs its review summary
---

# PR brief for Jakub

Jakub doesn't read code. Before a PR is marked ready, build one Artifact page that tells him what the PR does for the family and what it changes in the app's shape. Link it as the first line of the PR body: `Brief: <artifact URL>`.

## Contents, in this order

1. **Title + one sentence:** what users get. Czech feature names as they appear in the UI.
2. **What the user gets:** one short paragraph per role (taker, giver, admin) that is affected. Phone screenshots of every new or changed screen.
3. **How it flows:** a diagram (inline SVG) when the feature has steps, states, or hands over between people. Skip it for a single screen.
4. **Architecture impact:** what changed shape and what else it can affect: a diagram of touched parts, DB schema changes (table and column names), new dependencies. Write "None" if there is none.
5. **Risks and what to try:** what could go wrong for the family, and 2 or 3 things Jakub can click through.
6. **Stack:** stacked PRs only. The whole stack, with this PR highlighted.
7. **Review summary:** filled in at exit: rounds used, judges, what was fixed, deferred issues (links), anything escalated.

No implementation details: no function names, no code, no file lists.

## Screenshots

Playwright against the dev server, viewport 390×844, light theme, `deviceScaleFactor: 2`. Dark theme too only when the PR changes the theme or tokens. Seed data with realistic Czech task names.

## Publishing

Load the `artifact-design` skill, write the page to the scratchpad, and publish it with the Artifact tool (icon `code`). After the rounds, update it at the same path so the link stays the same.

## Common mistakes

- Describing code ("added `completeTask()`") instead of behaviour ("a taker can tap Hotovo on a reserved task").
- Leaving out architecture impact because "it's just a feature". Say "None" explicitly.
- Writing a long page. Jakub skims it in 2 minutes.
