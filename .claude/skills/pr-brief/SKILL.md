---
name: pr-brief
description: Use when a Taskmaster pull request is about to be marked ready for review, when its review rounds finish, or when anything the brief states changes later (Jakub answers a question, a push changes behaviour); the PR brief for Jakub must match the PR
---

# PR brief for Jakub

Before a PR is marked ready, build one Artifact page and link it as the first line of the PR body: `Brief: <artifact URL>`.

## Why the brief exists

Jakub owns this code. He maintains it long term, decides what it does to the family and the product, and defines the work. He reads briefs, not diffs. The brief explains the code change so he understands it without opening the code, and can:

1. **decide** whether to accept the PR as it is or ask for changes;
2. **make good later decisions** about this code (what to build next, what to change, what it costs);
3. **learn** how this part of the app works now. The brief is knowledge transfer from you to the owner.

He needs the change from several angles: the family using it, the data, infra, security, and the code that comes after. You are the one who read the code; your job is to teach it. Every block on the page makes a point that serves one of the three jobs. A block that makes no point ("not touched", "n/a", "nothing to show") is not on the page.

## How to build it

1. **Find the points.** Read the diff, the issue, the spec sections it implements and the code around it. Write down the things Jakub must walk away knowing, as many as this PR needs: a one-line fix may need one point, a new subsystem many. Cover what the PR does, how the changed part works now, how far it reaches, what could break, what needs him, where they apply. Be critical: look for downstream reach, duties left for later code, and places where the code drifts from the spec or his decisions.
2. **Pick a tool per point.** For each point, choose from the toolbox below the explanation that lands it fastest for someone who hasn't read the code. Different PRs need different tools: a scheduler change wants a timeline, a rule wants a worked example, a shared helper wants a usage map. One tool per point by default; add a second only when the first doesn't land the point. A tool not in the list is fine if it explains better. Each fact appears once, where it fits best (a drift in "Needs you" is not repeated in a spec trace; a risk caused by a missed duty links to the duty card instead of re-explaining it).
3. **Lay it out in the frame** (next section). The frame is the same every time; what's inside it is whatever your points need.

## The frame

Same order and look in every brief, so Jakub knows where to look:

1. **Header.** Title in plain words (family terms when a person will notice the change), one sentence on what the PR does, a verdict badge (`Ready to accept` or `Needs your call`) and a risk badge (low / medium / high) with one reason. If the PR has the `preview` label, link the preview URL here (from the PR's preview comment).
2. **Needs you.** Amber callout: what Jakub must decide, or must know to accept the PR: open decisions, assumptions you made where the spec was silent, spec or decision drift you found (with the issue that tracks it, if any), and every ruling you made while building (where the code left the plan the judges approved, and why). Verdict is `Needs your call` only if one of these must be settled before merge. Things you can fix yourself (a wrong title, a missing test) are fixed before the brief, not listed. If there is nothing, a quiet green line "Nothing needs you" instead of the amber box.
3. **The explanation.** Your points, in the order Jakub needs them, each under a heading that states the point ("Approvals reset when people change", not "Scenes"). The first one teaches how the changed part works now. Each point shows its main tool openly; extra depth (a second example, the full table, a snippet) goes in a `<details>` under it.
4. **What could go wrong.** Realistic failure modes only, each a `<details>` item. Summary line: failure + who or what is hit + how you'd notice. Inside: the mechanism, why tests do or don't catch it, the mitigation or owner (issue link). Depth scales with severity. Leave the section out when there is no realistic failure.
5. **Closing notes**, each only when it has content: Jakub's past decisions this PR implements (with date), the stack (stacked PRs only, this PR highlighted), the review summary after the rounds (rounds, judges, what was fixed, deferred issues as links, anything escalated).

## Toolbox

| Tool | Makes this point | Reach for it when |
| --- | --- | --- |
| **Mental model** (short prose + named concepts) | how the changed part works now | always, as the first point; plain words Jakub could repeat to someone else |
| **Concept card** | a new term or idea the code introduces | the PR adds a name Jakub will see again (a type, a state, a role) |
| **Scene card** (family story, Czech task names) | what a person experiences | a family member will notice the change; use real roles (Táta, Máma, the brothers, Jakub as admin) and tasks ("Vyndat myčku") |
| **Before / after pair** | what changed in behaviour or structure | a "before" exists |
| **If X / if Y pair** | a branching rule | the outcome depends on one condition |
| **Worked example** (steps or a small table with real numbers) | a rule applied end to end | points, periods, settlement, agreement counting: anything where Jakub should check the arithmetic |
| **Decision table** | many conditions → outcomes | three or more conditions combine |
| **State diagram** | a lifecycle | the PR adds or changes states or transitions |
| **Flow or sequence diagram** | who calls whom, in what order | more than two steps or actors (UI → server function → domain → DB, a job, a webhook) |
| **Lanes / timeline** | ordering in time | concurrency, the scheduler, CI runs, races, deadlines |
| **Usage map** | where shared code is used and where the change leads | the PR changes a shared module, helper, component, contract or token; show callers and long-term maintenance effect |
| **Layer map** | where new code sits in the architecture | a new module or layer appears |
| **Data sketch** (sample rows, schema before/after) | the shape of stored data | schema, migration, stored formats, audit entries |
| **Blast radius table** | what is touched directly and what is affected downstream | anything shared or with downstream effect; rows only for touched or affected areas, with severity if wrong and why |
| **Duty card** | what later code or callers must remember | the PR leaves an obligation for a later PR, a caller or ops |
| **Spec trace** (spec line → what the code does) | conformance to the spec | the PR implements §5 rules or a Jakub decision |
| **Alternatives** | why this design | you chose between real options Jakub might question |
| **Code snippet** | the exact rule, check or change | the point is crucial and affects many places, or code says it faster than prose |
| **Screenshot** / **preview link** | what a screen looks like | screens changed |

Diagrams: load the `artifact-diagramming` skill. Code snippets: real code trimmed with `// …`, short, file path under each, scrolled inside the block at phone width.

Screenshots: Playwright against the dev server, the iPhone 15 Pro screen: viewport 393×852, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true`, light theme. Set these yourself: Playwright's `devices['iPhone 15 Pro']` has a shorter viewport (Safari bars), and the app runs as an installed PWA with the whole screen. Dark theme too only when the PR changes the theme or tokens. Seed realistic Czech task names.

A screenshot shows exactly what a phone shows: one 393×852 screen, never the whole page. Use `page.screenshot()` with no `fullPage` (or `fullPage: false`), so every file is 1179×2556 px; never `fullPage: true`, never an element screenshot taller than the screen. When the part that matters sits below the fold, scroll to it (`locator.scrollIntoViewIfNeeded()` or `window.scrollTo`) and take another 393×852 screenshot of that spot. Check each file's size before you publish it; one that is not 1179×2556 is retaken.

Screenshots on the page keep their natural aspect ratio, big enough to read. Put every screenshot `<figure>` inside one grid; give each `<img>` its real `width`/`height` attributes and this CSS:

```css
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px}
.shots img{width:100%;height:auto;display:block}
```

`height:auto` is the must: with `width`/`height` attributes and only `max-width:100%`, the browser shrinks the width and keeps the height, so the screen looks squashed. Never set a fixed height on a screenshot. One column on a phone, two on a laptop.

## Look

Load the `artifact-design` skill. Keep one visual vocabulary across briefs so things are easy to spot:
- verdict and risk badges in the header (green / amber / red);
- "Needs you" as an amber callout right under the header (a quiet green line when empty);
- verdict badge green for `Ready to accept`, amber for `Needs your call`;
- before/after and if/if pairs as two panels (grey before, green after, red for an outcome where a rule bites), one column on a phone;
- light and dark tokens for every colour;
- screenshots at their natural aspect ratio, one or two per row (see Screenshots above).

Scannable first, depth inside expandables. Jakub should get the verdict, the "Needs you" items and the shape of the change at a glance, however big the PR; the visible length follows the PR's size and the rest waits in expandables for when he wants to learn more.

## Publishing

Write the page to the scratchpad and publish it with the Artifact tool (icon `code`). Mention issues and PRs as title + GitHub link. Republish at the same path so the link stays the same.

## Keep it current

The brief must always match the PR. Republish it (same path, same link) in the same turn as any of these:
- Jakub answers an open question: move it from "Needs you" to the decisions note (his answer, date) and update the verdict.
- A push changes behaviour, scope, dependencies or schema that the brief describes.
- The `preview` label is added or removed.
- The review rounds finish (review summary).

Before telling Jakub a PR is ready, reread its brief against the PR body and the latest commit.

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Section per toolbox row, filled because it exists | Points first, then only the tools that land them |
| Scenes for a PR no person can notice yet (domain rules with no screen) | Worked example, decision table or state diagram |
| Only behaviour and risk, no mental model | First point teaches how the code works now |
| Blast radius lists only the diff | Add downstream: callers, screens that use the changed component, later PRs |
| Describing code ("added `completeTask()`") | Behaviour plus the model ("a taker can tap Hotovo on a reserved task; the lifecycle in `src/domain/` checks it") |
| Repeating the PR body or the judges' threads | Link them; say only what Jakub needs |
| Stacking three tools on one point, the page buries the verdict | Main tool open, the rest in `<details>` |
