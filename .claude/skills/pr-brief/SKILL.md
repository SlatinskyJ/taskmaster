---
name: pr-brief
description: Use when a Taskmaster pull request is about to be marked ready for review, when its review rounds finish, or when anything the brief states changes later (Jakub answers a question, a push changes behaviour); the PR brief for Jakub must match the PR
---

# PR brief for Jakub

Before a PR is marked ready, build one Artifact page and link it as the first line of the PR body: `Brief: <artifact URL>`.

## Why the brief exists

Jakub owns this code. He maintains it long term, decides what it does to the family and the product, and defines the work. He reads briefs, not diffs. The brief is his way of understanding the code change without opening the code, so that he can:

1. **decide** whether to accept the PR as it is or ask for changes;
2. **make good later decisions** about this code (what to build next, what to change, what it costs);
3. **learn** how this part of the app works now. The brief is knowledge transfer from you to the owner.

He needs the change from several angles: the family using it, the data, infra, security, and the code that comes after. Every sentence must help one of the three jobs above. If a section would say nothing new ("not touched", "n/a", "no risk"), leave it out.

## Form: fixed frame, sections only when they earn it

Every brief looks the same, so Jakub knows where to look: same order, same badges, same callout colours. But only the frame is fixed. Sections appear when they carry something for this PR and are left out otherwise. Never pad a section to fill the template.

### Always

- **Header.** Title in family terms, one sentence on what the PR does, a verdict (`Ready to accept` or `Needs your call`) and a risk badge (low / medium / high) with one reason. If the PR has the `preview` label, link the preview URL here (from the PR's preview comment).
- **How it works now.** The mental model of the changed code after this PR, in plain words: the concepts it adds or changes, where they live, how data or control flows, which rule or contract it relies on. Write it so Jakub could explain the part to someone else. A small diagram (skill `artifact-diagramming`) when the flow has more than two steps. When the PR changes shared or library code, say where it is used and where the change leads for long-term maintenance.
- **Needs you.** Open decisions for Jakub, and assumptions you made where the spec was silent (marked as such). Bright callout, always in the same spot right under the header. If there is nothing, one line: "Nothing needs you."

### When it earns its place

- **Scenes**: when a person could notice the change. 2–5 short cards with real family roles and Czech task names (Táta, Máma, the brothers, Jakub as admin; "Vyndat myčku"): situation → what happens now. Before/after only where a "before" exists. Include the edge case where the new rule bites. If the PR has a preview, say what to try there. Phone screenshots in the cards when screens changed (see Screenshots).
- **Blast radius**: what the change touches directly, and what it can affect downstream that the diff doesn't show (a shared component changed in one place that a user meets on another screen; a helper whose callers now behave differently; a duty later PRs must keep). One row per area that is touched or affected, with Directly/Downstream, severity if wrong (low/med/high) and why. Don't list areas that are not touched. Be skeptical about hidden reach: shared modules, implicit contracts, things callers must remember.
- **What could go wrong**: realistic failure modes only, each a `<details>` item. Summary line: failure + who or what is hit + how you'd notice. Inside: the mechanism (module, function, table, job, the condition that triggers it), why tests do or don't catch it, and the mitigation or owner (issue link). Depth scales with severity.
- **Decisions**: Jakub's past decisions this PR implements (with date), when they shape the code.
- **Stack**: stacked PRs only. The whole stack, this PR highlighted.
- **Review summary**: filled in when the review rounds end. Rounds used, judges, what was fixed, deferred issues (links), anything escalated.

## Code and diffs

Code is never there by default. Show it only when it serves a point:
- a crucial change that affects many places (a shared helper, a contract, a migration that changes or drops data);
- it delivers an idea faster than prose (a §5 rule, a role or auth check, an audit write).

Real code trimmed with `// …`, a few short snippets at most, file path under each, scrolled inside the block at phone width. If you need many snippets, the prose is missing something.

## Screenshots

When a PR changes screens: Playwright against the dev server, viewport 390×844, light theme, `deviceScaleFactor: 2`. Dark theme too only when the PR changes the theme or tokens. Seed realistic Czech task names.

## Look

Load the `artifact-design` skill. Keep one visual vocabulary across briefs so things are easy to spot:
- verdict and risk badges in the header (green / amber / red);
- "Needs you" as an amber callout;
- scene cards as before/after panels (grey before, green after, red for the edge case outcome), stacked to one column on a phone;
- light and dark tokens for every colour.

Scannable first, depth inside expandables. Jakub should get the verdict, the "Needs you" items and the shape of the change in about 2 minutes.

## Publishing

Write the page to the scratchpad and publish it with the Artifact tool (icon `code`). Mention issues and PRs as title + GitHub link. After the rounds, republish at the same path so the link stays the same.

## Keep it current

The brief must always match the PR. Republish it (same path, same link) in the same turn as any of these:
- Jakub answers an open question: move it from "Needs you" to "Decisions" (his answer, date) and update the verdict.
- A push changes behaviour, scope, dependencies or schema that the brief describes.
- The `preview` label is added or removed.
- The review rounds finish (review summary).

Before telling Jakub a PR is ready, reread its brief against the PR body and the latest commit.

## Common mistakes

- Filling every section because it exists. An empty or "n/a" section costs Jakub attention and teaches nothing.
- Describing code ("added `completeTask()`") instead of behaviour and the model ("a taker can tap Hotovo on a reserved task; the state change goes through the lifecycle in `src/domain/`").
- Skipping "How it works now" because the scenes look complete. Scenes show behaviour; Jakub also needs to understand the code he owns.
- Listing only what the diff touches and missing downstream reach.
- Pasting a diff to look thorough.
- Writing a long page.
