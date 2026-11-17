---
name: pr-brief
description: Use when a Taskmaster pull request is about to be marked ready for review, when its review rounds finish, or when anything the brief states changes later (Jakub answers a question, a push changes behaviour); the PR brief for Jakub must match the PR
---

# PR brief for Jakub

Jakub reads briefs, not diffs. Before a PR is marked ready, build one Artifact page that tells him what the PR does for the family and what it changes in the app's shape. Link it as the first line of the PR body: `Brief: <artifact URL>`.

## Contents, in this order

1. **Title + one sentence:** what users get. Czech feature names as they appear in the UI.
2. **What the user gets:** one short paragraph per role (taker, giver, admin) that is affected. Phone screenshots of every new or changed screen.
3. **How it flows:** a diagram (inline SVG) when the feature has steps, states, or hands over between people. Skip it for a single screen.
4. **Architecture impact:** what changed shape and what else it can affect: a diagram of touched parts, DB schema changes (table and column names), new dependencies. Write "None" if there is none.
5. **Crucial code:** optional. Only the few lines Jakub must see to trust the PR (see below). Skip the section when nothing qualifies.
6. **Risks and what to try:** what could go wrong for the family, and 2 or 3 things Jakub can click through.
7. **Stack:** stacked PRs only. The whole stack, with this PR highlighted.
8. **Review summary:** filled in at exit: rounds used, judges, what was fixed, deferred issues (links), anything escalated.

Outside the Crucial code section: no implementation details, no function names, no file lists.

## Crucial code

Jakub reads code fine. Show code only where it decides behaviour he cares about and prose would hide the detail: a §5 rule (points, agreement, settlement, periods), a role or auth check, an audit write, a migration that changes or drops data, a risky edge case. Not plumbing, UI wiring, or boilerplate.

- Real code by default, trimmed with `// …`. Pseudocode only when the real code is spread over many places or framework noise hides the logic; label it "pseudocode".
- At most 3 snippets, each ≤ 20 lines. Fewer is better; zero is fine.
- One line above each: what it decides and why it matters. Then the file path (and line) under it, so he can find it in the diff.
- Monospace block, light syntax colour via theme tokens, readable at phone width (wrap or scroll inside the block, never the page).

## Screenshots

Playwright against the dev server, viewport 390×844, light theme, `deviceScaleFactor: 2`. Dark theme too only when the PR changes the theme or tokens. Seed data with realistic Czech task names.

## Publishing

Load the `artifact-design` skill, write the page to the scratchpad, and publish it with the Artifact tool (icon `code`). After the rounds, update it at the same path so the link stays the same.

## Keep it current

The brief must always match the PR. Republish it (same path, same link) in the same turn as any of these:
- Jakub answers an open question or decision card: turn "Your call" into "Decided" (his answer, date) and drop it from the lede and review summary.
- A push changes behaviour, scope, dependencies or schema that the brief describes.
- The review rounds finish (review summary).

Before telling Jakub a PR is ready, reread its brief against the PR body and the latest commit.

## Common mistakes

- Describing code ("added `completeTask()`") in the prose sections instead of behaviour ("a taker can tap Hotovo on a reserved task").
- Leaving out architecture impact because "it's just a feature". Say "None" explicitly.
- Pasting a big chunk of the diff as "crucial code". If it needs more than 3 short snippets, the prose is missing something.
- Writing a long page. Jakub skims it in 2 minutes.
