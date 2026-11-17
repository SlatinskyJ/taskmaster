---
name: pr-brief
description: Use when a Taskmaster pull request is about to be marked ready for review, when its review rounds finish, or when anything the brief states changes later (Jakub answers a question, a push changes behaviour); the PR brief for Jakub must match the PR
---

# PR brief for Jakub

Jakub reads briefs, not diffs. Before a PR is marked ready, build one Artifact page that tells him what the PR does for the family and what it changes in the app's shape. Link it as the first line of the PR body: `Brief: <artifact URL>`.

## Goal

Explain the PR to Jakub, the code owner, so he understands what changed, how it behaves for the family, how far its effects reach, and what could break, technically. Sections are tools, not a checklist: skip or shrink any that does no work for this PR, but always think about blast radius.

Shape:
1. **Title + one-line verdict**: the change in family terms + overall risk (low / medium / high) with one reason.
2. **Scenes as cards** (2–5): tiny stories with real family roles/names and Czech task names (Táta, Máma, the brothers, Jakub as admin; "Vyndat myčku", "Umýt auto"). Each card: situation → what happens now. Use before/after only where a "before" exists; otherwise "now possible" or "if X vs if Y". Include one edge-case card where the new rule bites. Skip scenes entirely for PRs with no behaviour a person could notice (pure CI/infra) and say so in one line.
   - Visual design: a muted "Cast (spec §3)" line first, then each scene stacked full width as a numbered h3 ("1. …", the edge case ends "(the rule bites)") over a two-column pair of panels (one column under 560px): left panel on a grey `--before` fill, right panel on a light-green `--after` fill with a 3px green left border, the edge case's outcome panel on a light-red `--crit` fill with a 3px red left border; each panel opens with a tiny uppercase muted tag (Before/After, Situation/Now, or If X/If Y), 8px radius, 10–12px padding, Czech task names in bold, light and dark tokens for every fill.
3. **Impact grid**: table, one row per area — Family (behaviour/screens), Data & DB, Domain rules (spec §), Infrastructure (CI, Docker, deploy), Security & privacy, Dependencies, Future code (contracts/duties later PRs must keep). Columns: Touched (no / indirect / yes), Severity if wrong (low/med/high), Why (one line). Fill every row honestly; be skeptical about hidden reach (shared modules, implicit contracts, things callers must remember).
4. **What could go wrong**: the realistic failure modes, each as an expandable item (`<details>`): summary line = failure + who/what is hit + how you'd notice. Inside, the **technical explanation**: the mechanism (which function/module/table/job, the code path or condition that triggers it), why tests do or don't catch it, and the mitigation or owner (issue link). Add a trimmed real code snippet only when it makes the mechanism clear. Depth scales with severity: a low-risk item can be two sentences, a high-risk one a short paragraph plus snippet.
5. **Decisions & assumptions**: spec gaps the agent filled (mark as assumption) vs Jakub's decisions (with date). Keep current: when Jakub decides, move it here.
6. **Under the hood** (optional, 3–5 bullets): modules, new dependency/schema/CI change, if not already obvious from the grid.

Style: scannable, cards and table up top, technical depth in the expandables. ~500 words visible, details may add more. Mention issues/PRs as title + GitHub link.

7. **Stack** (stacked PRs only): the whole stack, this PR highlighted.
8. **Review summary**, filled in at exit: rounds used, judges, what was fixed, deferred issues (links), anything escalated.

## Code in the brief

Code lives only inside "What could go wrong" details (and "Under the hood"). Show it only where it decides behaviour Jakub cares about: a §5 rule, a role or auth check, an audit write, a migration that changes or drops data. Real code trimmed with `// …`, at most 3 snippets of ≤ 20 lines, file path under each, wrapped or scrolled inside the block at phone width.

## Screenshots

When a PR changes screens, put phone screenshots in the scene cards. Playwright against the dev server, viewport 390×844, light theme, `deviceScaleFactor: 2`. Dark theme too only when the PR changes the theme or tokens. Seed data with realistic Czech task names.

## Publishing

Load the `artifact-design` skill, write the page to the scratchpad, and publish it with the Artifact tool (icon `code`). After the rounds, update it at the same path so the link stays the same. Reference look: [Brief D](https://claude.ai/artifact/6mLR6vpdVM89kefECeWFZG).

## Keep it current

The brief must always match the PR. Republish it (same path, same link) in the same turn as any of these:
- Jakub answers an open question or decision card: move it from open questions to "Decisions & assumptions" (his answer, date) and drop it from the verdict and review summary.
- A push changes behaviour, scope, dependencies or schema that the brief describes.
- The review rounds finish (review summary).

Before telling Jakub a PR is ready, reread its brief against the PR body and the latest commit.

## Common mistakes

- Describing code ("added `completeTask()`") in the prose sections instead of behaviour ("a taker can tap Hotovo on a reserved task").
- Leaving impact grid rows empty or all "no" without thinking about hidden reach (shared modules, duties for later code).
- Pasting a big chunk of the diff. If it needs more than 3 short snippets, the prose is missing something.
- Writing a long page. Jakub skims it in 2 minutes.
