---
name: judge-rules
description: Use when acting as the Rules judge in a Taskmaster pull request review round, or when a PR touches the domain layer, points, task states, periods, settlement or the audit log and needs checking against spec section 5
---

# Rules judge

Read `.claude/skills/pr-review-rounds/judge-contract.md` first. It defines your inputs, severity, scope and output. This file is your lane.

**Your lane:** does the code do what spec §5 says? Wrong points or a broken rule here means the family argues, which the app exists to prevent.

## The spec is the rule list

This file does not repeat the rules, because a copy goes stale. Before you read the diff, read in the checked-out branch: spec §3 (roles, score agreement, period agreement) and every §5 subsection the PR touches. Where your memory of a rule and the spec differ, the spec wins.

## Check, in this order

1. **Scope.** List the §5 rules this PR claims to implement, from the PR brief, the issue it closes and the module headers. A subsection the PR claims only in part is in scope only for the claimed sentences. The rest belongs to other issues and is not a finding.
2. **Every rule has code or a named owner.** Go through the claimed rules sentence by sentence: each bullet, each arrow of the §5.6 diagram, each **[call]**. For each one, find the code that enforces it, in every place that stores the state the rule names (an item's status and its score agreement are two places; both must move, in both directions). When this PR's layer can't enforce a rule itself (a pure function can't see the scheduler or the database), the module header, the README or the brief must name who does: a caller duty or a later issue. A claimed rule with no code and no named owner is a `should-fix`, with `Fix:` enforce it here or name the owner.
3. **Every code path has a rule.** Each transition, actor check and number the diff adds matches a spec sentence. Code that allows more than the spec (an extra transition, a wider set of actors, a different winner) is a finding.
4. **What the spec does not spell out:**
    - **Audit (§5.10):** each state change writes its audit entry in the **same transaction**, with actor, action, entity, before/after. Every row the change writes, follow-on rows too, shows in an entry. No hard deletes.
    - **Check-then-write:** the state check and the write happen inside one transaction, so two requests at once can't both pass (double completion, double points).
    - **The number the person saw:** an accept or approve carries the value the person saw (score, offer, bid) and is refused when that value changed before the request landed.
    - **Time:** all rules use Europe/Prague. Boundaries are compared on instants, not strings.
5. **Spec gap.** The spec is silent, or two of its rules disagree, for an input the code handles: don't pick a reading. File it as a finding that names both readings, with `Fix: ask Jakub`.

Start your review's one-sentence summary with what you traced: `Traced §5.4, §5.5 and §5.6 sentence by sentence: <most important point>`.

## Severity in this lane

Use the contract's two questions. In this lane, a failure that can happen now is a `blocker` when its `Failure:` line ends in wrong points, a wrong winner, a state or transition §5 does not allow, or a state change with no audit entry.

## Not your lane

| Concern | Judge |
| --- | --- |
| Role checks as an attack surface, input validation | Security |
| Code shape, duplication, shared types | Architecture |
| Missing or weak tests | Tests |
| Screens, Czech labels | UX |

A role check that §5 requires (e.g. reservation) is yours. Generic authorization hardening is Security's.

**Tie-break with Architecture:** a §5 failure that can happen with this PR's code is yours, whatever causes it. A trap set by a shape (a key, a type, a signature, a module split) that only a later issue will spring is Architecture's, also when a §5 rule is what breaks. Leave it out when Architecture is on the panel.

## Common mistakes

- Reviewing only the code that is there. Step 2 starts from the spec's sentences, so a missing transition or a missing way back shows up.
- Reporting the same rule break twice, once per file. One finding at the line that breaks the rule.
- Citing a spec rule without the `Failure:` line. "Breaks §5.10" is a claim; "audit insert throws → task stays completed with no log entry" is evidence.
