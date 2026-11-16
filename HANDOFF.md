# Handoff: Taskmaster

For the Claude project **Taskmaster**, which takes over from here: implementation planning, the detailed infrastructure plan, and the build.

## Goal

A small, self-hosted web app the Slatinský family uses to track household chores and points:
- tasks have a point score **agreed in advance**;
- points build up per child;
- a **weekly meeting** (Sunday evening, led by Dad) settles points into a pocket-money level, then plans next week;
- everything is traceable through an append-only audit log.

It is hosted on **SLNAS** (Dad's Synology NAS) and reachable from the public internet on a **`slatinsky.cz` subdomain**, with a login for each user.

**The source of truth is the approved spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md`. Read it in full before doing anything.

## Current progress

- [x] Brainstorming with the owner (Jakub) finished. Every rule in the spec was agreed with him, except the items marked **[call]**, which are sensible defaults he has reviewed and may still overturn.
- [x] Spec written, reviewed by an independent "builder check", and **approved by the owner on 2026-11-16**.
- [ ] Implementation plan: **not started**.
- [ ] Infrastructure plan: **not started**. Section 8.1 of the spec lists the facts to collect; **section 8.2 records the answers collected 2026-11-16 and the remaining gaps** (NAS model/arch/DSM, Cloudflare decision, WEDOS zone export, subdomain name, off-site backup call).
- [ ] Code: none yet. The repo contains only the spec and this file.

Repo: `SlatinskyJ/taskmaster`, branch `claude/relaxed-cannon-g3e6vf` (the spec was committed there).

## Key decisions (summary; the spec has the details)

- **Approach A:** a small custom web app. One server plus a single-file SQLite database in one Docker container on SLNAS. Mobile-first, PWA-ready. Rejected: adapting Grocy/Donetick-style apps (none supports bidding, all-party agreement, or settlement) and no-code tools (not self-hosted, leaky rules).
- **People:** 2 takers (brothers aged 13 and 18, same levels), 1 giver (Dad). Mum is a future giver, added via config. Jakub is **admin only** and not a party to tasks.
- **Score agreement:**
  - recurring templates need all parties;
  - one-time tasks either get all-party approval (they then sit in the queue) or go through bidding between a giver and one taker (agreement reserves the task to that taker).
- **Recurring instances:**
  - created by schedule, on demand by a giver, or self-logged by a taker (self-logged always needs approval);
  - each template has either no deadline, or a deadline plus a grace window, after which the instance expires.
- **Completion:**
  - an approval-required flag on each task or template;
  - "done, unconfirmed" points are shown separately from confirmed points;
  - a rejected completion goes back to the same taker's reservation if it was reserved, otherwise back to open.
- **Periods:**
  - run from settlement to settlement, 7 days by default;
  - length and levels can change only with all-party agreement **before** the period starts;
  - a completion counts toward the period its `completed_at` falls in.
- **Settlement:**
  - total ≥ upper → deduct the upper level's points;
  - total ≥ lower → deduct the lower level's points;
  - below lower → no money, no debt, everything carries over;
  - settlements are final; only the admin can correct, as a forward adjustment.
- **Language:** Czech UI labels. English code, identifiers, and DB.
- **v1 non-goals / stretch:**
  - stretch goals: a shared tablet with name+PIN quick switch (auth must leave room for it), PWA install, push notifications;
  - not in v1: money amounts, a user-management UI, a log UI.

## What worked

- Asking the owner one question at a time and playing each part back. The rules in section 5 came out precise and he confirmed each part.
- Running an independent builder check on the spec. It surfaced the hosting unknowns and the settlement-correction rule, which is now in the spec.

## What didn't work / watch out

- **The SLNAS facts are unknown** (model/arch, RAM, Docker support, access level). Don't write a deployment plan that assumes Container Manager or SSH before they're verified.
- **SLNAS belongs to Dad and lives on his tailnet.** Jakub reaches it through a Tailscale node share, which Dad can revoke. Other services already run on the NAS (ports in private notes); don't clobber them.
- **Dad owns the `slatinsky.cz` DNS.** Any DNS or router change goes through him.
- **Public internet exposure is a real security surface:** HTTPS only, hashed passwords, login rate limiting, no self-signup.

## Next steps

1. **Collect the infra facts** in spec section 8.1 from Jakub/Dad:
   - SLNAS model/arch/DSM/RAM/Container Manager;
   - Jakub's access level;
   - whether router port-forwarding is allowed, CGNAT, public IP;
   - who controls DNS;
   - an off-site backup destination.
2. **Write the implementation plan** from the spec. The stack is decided (spec section 11: TanStack Start + SQLite/Drizzle, own session auth, multi-arch image). Put heavy automated tests on the section 5 rules (agreement, lifecycle, period attribution, settlement arithmetic).
3. **Write the infrastructure plan:** deployment to SLNAS, exposure method (port-forward + Synology reverse proxy + Let's Encrypt, or a tunnel), the subdomain, TLS, backups (local + off-site), and the update procedure.
4. **Build in vertical slices.** A suggested order, which the plan may change:
   1. auth + users seed;
   2. one-time tasks with all-party approval;
   3. completion/approval and the points display;
   4. recurring templates/instances;
   5. bidding;
   6. periods + meeting/settlement;
   7. audit log throughout (from slice 1, not bolted on).
5. Deploy, then do a trial week with the family before switching off the whiteboard bookkeeping.
