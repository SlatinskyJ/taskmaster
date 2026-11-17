# Taskmaster — Family Chore Points: Design

- **Date:** 2026-11-16
- **Status:** Approved by owner, 2026-11-16
- **Owner:** Jakub (system admin)
- **Next step:** a separate Claude project takes this spec and produces the implementation plan, the detailed infrastructure plan, and the build.

Items marked **[call]** were decided by the spec author (Claude), not by the owner. They are reasonable defaults the owner may overturn. Everything else was decided by the owner during brainstorming.

---

## 1. Intent

The Slatinský family tracks who did which household chores, and pocket money depends on it. Today this is done on a whiteboard and in conversation. The app replaces the bookkeeping:

- every chore has a **point score agreed in advance** by the people it concerns, so there is no argument afterwards about what it was worth;
- points accumulate in a **running total** per child;
- a **weekly meeting** (Sunday evening, led by Dad) settles the week: points are converted into a pocket-money level and deducted, then next week's work is planned;
- **everything is traceable**. If anyone disputes a number, the history can be reconstructed from the log.

Success means the family uses it every week instead of the whiteboard bookkeeping, and nobody has to argue about points.

## 2. Goals, non-goals, anti-goals

### Goals (v1)
- One-time and recurring tasks with agreed point scores.
- Score agreement rules: giver + taker approval, and a bidding flow for one-time tasks.
- Optional reservation, completion, and giver approval of completed work.
- Per-taker running total with **confirmed** and **pending** points shown separately against the period's levels.
- Periods (settlement to settlement) with configurable length and levels, agreed before the period starts.
- A guided weekly meeting flow: clear pending → settle → plan.
- An append-only audit log of every change.
- Login for every user. The app is reachable from the public internet on a `slatinsky.cz` subdomain, hosted on SLNAS.
- Czech UI labels. English code, identifiers, and database.

### Non-goals (v1, possible later)
- **Stretch:** shared tablet by the home whiteboard with quick user switching (name + PIN, auto-logout). v1 auth must not block adding this later.
- **Stretch:** installable PWA and push notifications. iOS supports web push for home-screen PWAs (16.4+), so this is a viable later path.
- No in-app notifications beyond what is visible when a user opens the app (badges/counts are fine).
- No money amounts in the app. The app reports the level reached; money is handled outside.
- No per-person levels. Both takers share the same levels.
- User management is admin-only, in the admin console (section 6). No self-signup.
- No UI for the audit log.
- Single household only.

### Anti-goals (failure even if it "works")
- Points disputes that cannot be resolved because history was edited or lost.
- A process heavier than the whiteboard. If agreeing on a dishwasher task takes more effort than doing it, the app has failed.
- Losing data (the NAS dies or the DB gets corrupted) with no backup.
- Being openly exploitable on the public internet (weak auth, no TLS).

## 3. People and roles

| Person | Role | Notes |
|---|---|---|
| Brother (18) | **Taker** | Has a running score |
| Brother (13) | **Taker** | Has a running score. UI must be simple enough for a 13-year-old on a phone |
| Dad (Milan) | **Giver** | Leads the weekly meeting. Owns SLNAS and the `slatinsky.cz` domain |
| Mum | **Giver** (future) | Not created in v1. The admin adds her later in the admin console, with no code change |
| Jakub | **Admin** | Looks after the system. **Not a party** to any task or agreement |

Role rules:
- **Taker**: can approve scores, bid, reserve, complete, and log unprompted chores. Has a running total. Can flag a locked item as **disputed** (5.11).
- **Giver**: can create tasks, templates, and instances, approve scores, respond to bids, complete tasks (no points, no running total "for now"), approve or reject completions, and run the meeting/settlement. Can propose a change to the **default period settings**, which needs period agreement (5.8), and can flag a locked item as **disputed** (5.11).
- **Admin**: manages users in the admin console (section 6), global settings (default levels, default period length), and templates if needed; can correct a finalized settlement and make manual point adjustments; **settles disputes** (5.11). All admin actions are logged. The admin does not count as a "party" for any agreement.
- **"All parties"** = all active givers + all active takers. When Mum is added, she becomes part of "all parties" automatically.
- **Score agreement** (Jakub, 2026-11-17) = at least **one active giver and one active taker** approved the score. Proposing a score counts as approving it. Scores are whole numbers from 1. The admin never counts. This replaces all-party approval for task and template scores (5.1, 5.2).
- **Period agreement** (Jakub, 2026-11-17) = **every active taker and at least one active giver** approved the change. Proposing counts as approving. The admin never counts. Used for period settings and their defaults (5.8).

## 4. Concepts

| Term | Meaning |
|---|---|
| **Task (one-time)** | A single piece of work with its own score |
| **Template (recurring)** | A reusable chore definition (name, score, schedule, deadline rules, approval flag). Not itself done |
| **Instance** | One occurrence of a template that can be done. Takes the template's score **at the moment it is created** |
| **Score** | Points awarded to the taker who completes it |
| **Agreement** | The state in which a score is accepted by the required parties. Nothing can be reserved or completed for points before agreement |
| **Bid** | A negotiation between one taker and the giver side over a one-time task's score |
| **Reservation** | Optional claim ("I'll do this"). Prevents others from doing it for points |
| **Completion** | Someone marks the work done |
| **Approval** | A giver confirms a completion. Points become *confirmed* |
| **Period** | The span between two settlements ("week"). Has a cutoff and levels |
| **Levels** | Two thresholds per period: **lower** (agreed minimum; reaching it means base pocket money) and **upper** (higher pocket money) |
| **Settlement** | The end-of-period accounting for each taker |
| **Running total** | A taker's confirmed points not yet deducted by a settlement (includes carry-over) |

## 5. Rules

### 5.1 Score agreement — recurring templates
- A template's score needs **score agreement** (one giver + one taker, section 3). Until then, the template is *proposed* and creates no instances.
- After agreement, **any party** may propose a new score. It needs score agreement again; the old score stays in force until the change is agreed.
- Only givers create templates. One score change may be in flight per template at a time; changes to different templates can run in parallel (Jakub, 2026-11-17).
- A template score change runs **the same way as bidding on a one-time task** (5.2 path 2), with these differences (Jakub, 2026-11-17):
  - Each party has at most one open bid in the change; bidding again replaces it. Every bid is kept in the history.
  - When the giver side accepts, it accepts the lowest open bid. The template gets that score; nobody is reserved anything.
- A score change applies only to instances created after the change is agreed. Existing instances keep their score, consistent with "score fixed at creation" (Jakub, 2026-11-17).

### 5.2 Score agreement — one-time tasks
A giver creates a one-time task with an initial offer (score). From there, two paths run in parallel, and the first to complete wins:

1. **Score agreement.** One giver and one taker approve the offered score (the giver's offer counts as the giver's approval, so one taker's approval is enough). The task becomes **open** at that score and sits in the queue; any taker may reserve or do it later.
2. **Bidding.** A taker counters with a different score. That taker and the giver side go back and forth (offer/counter/accept). When both sides accept the same number, the task becomes **reserved to that taker** at that score. Other takers do not need to agree.

Details:
- Several takers may bid on the same task at the same time (Jakub, 2026-11-17):
  - Each taker has **at most one open bid** per task. Bidding again **replaces** his own open bid, as often as he likes (e.g. brother 1 goes from 25 to 23). Nobody waits for a turn.
  - Every bid and counter is **kept in the history**. The giver side sees the task with all bids and their history; a taker sees the history when making a bid (task detail and feed).
  - When the giver side accepts, it accepts the **lowest** open bid (the best one for the givers). If one taker holds the lowest bid, the task becomes reserved to him at that score; if several takers tie at the lowest, the task becomes **open** at that score and they sort out who takes it.
  - On acceptance all other bids on that task close, and pending score approvals are discarded.
- **[call]** On the giver side, any active giver may accept or counter a bid (so Mum or Dad can respond).
- A taker may also simply accept the giver's current offer within a bid, which is agreement plus reservation in one step.
- Changing the score of an agreed one-time task:
  - if reserved: needs that taker + a giver;
  - if open (unreserved): any party may propose it; needs score agreement (a giver + a taker), and the old score stays until then;
  - once completed: the score is frozen (only the admin can correct, via adjustment).

### 5.3 Recurring instances
A template defines:
- **Schedule** (optional): the days (and optionally a time) an instance is created automatically, e.g. trash every Tuesday, bins Sunday evening.
- **Deadline mode**, one of:
  - **No deadline** (e.g. dishwasher): the instance stays open until someone does it.
  - **Deadline + grace window** (e.g. bins out before the collection truck): the instance has a due time. Completion may still be logged during a grace window after the due time (the person did it on time and only logs it afterwards). After the grace window the instance **expires**; no points, logged.
- **Approval required** flag (see 5.5).

Instances come into existence three ways:
1. **Scheduled**: created automatically by the schedule. **[call]** If an earlier *no-deadline* instance of the same template is still open, no duplicate is created.
2. **On demand**: a giver creates an instance whenever needed ("dishwasher is full"), possibly several times a day.
3. **Self-logged by a taker**: a taker did a recurring chore unprompted. They log it against the template; it is created directly in **done, unconfirmed** and **always** requires giver approval, regardless of the template's approval flag.

### 5.4 Reservation
- Optional. Anyone may complete an open task or instance without reserving it first.
- A reserved item can be completed for points only by the reserving taker. **[call]** A giver may still complete it (givers earn no points).
- **[call]** A taker may release their own reservation; a giver may release anyone's. Both are logged.
- **[call]** Releasing a bid-agreed one-time task returns it to negotiation with the agreed score as the current offer, since that score was only agreed by one taker.

### 5.5 Completion and approval
- Each one-time task and each template has an **approval required** flag. **[call]** Default: on.
- Flag on: completion → **done, unconfirmed** (pending). A giver approves → **confirmed**, and points count. A giver rejects → it returns to the state it came from, with an optional reason, logged: if it was **reserved** before completion, it goes back to **reserved by the same taker**, so nobody else can take it; otherwise it goes back to **open**. **[call]** A rejected self-logged chore (5.3) is closed as *rejected*, since it was never an open instance.
- Flag off: completion → **confirmed** immediately.
- Self-logged unprompted chores always need approval (5.3).
- A giver completing a task: it is closed with no points awarded. **[call]** No approval step.
- Every completion stores `completed_at` (the time it was marked done). The period a completion belongs to is determined by `completed_at`, not by approval time.

### 5.6 Lifecycle (one-time task and instance)

```
proposed/negotiating ──(agreed)──► open ──(reserve, optional)──► reserved
                                    │  ▲                            │
                                    │  └──────(release)─────────────┘
                                    ▼                               ▼
                               done, unconfirmed ◄──────────────────┘
                                    │
                 (giver approves) ──┴── (giver rejects → back to reserved if it was reserved, else open)
                        ▼
                    confirmed  (points count)

Instances with a deadline: open/reserved ──(deadline + grace passed)──► expired
Any non-completed item: ──(giver cancels)──► cancelled   [call]
```

Instances skip the negotiation state; they are born *open* at the template score (or *done, unconfirmed* when self-logged).

### 5.7 Points display
Each taker sees, for the current period:
- **Confirmed points** (the running total: carry-over + confirmed this period);
- **Pending points** (done, unconfirmed), shown separately in a different colour;
- both against the **lower** and **upper** levels, so they can see how far they are from each level and how much is certain.

Example: `45 potvrzeno + 15 čeká · spodní hranice 50 · horní 100`.

Givers see the same for every taker.

### 5.8 Periods
- A period runs from the previous settlement's cutoff to its own **cutoff** (date + time). It is not tied to calendar weeks.
- Defaults (global settings): length 7 days, cutoff Sunday evening (**[call]** 18:00 Europe/Prague), default lower/upper levels.
- **Changing the defaults (Jakub, 2026-11-16):** the admin can change them directly. A **giver** can also propose a change; it takes effect only after **period agreement** (section 3), the same way as a per-period change. Either way, a new default applies only to periods that have not started yet; the running period never changes. **[call]** A proposal that has not been agreed by the time the next period starts stays open for the period after it, until it is agreed, rejected, or withdrawn.
- The next period is created automatically with defaults. A different **length/cutoff** or different **levels** for a period need **period agreement (section 3) before that period starts**. Once a period has started, its cutoff and levels are locked.
- **[call]** If no settlement has happened by the cutoff, the next period still starts at the cutoff. Completions after the cutoff belong to the next period even if the meeting hasn't been held yet.
- Settlement of a period is allowed any time after its cutoff.

### 5.9 Weekly meeting and settlement
A giver (normally Dad) runs a guided **meeting screen**:

1. **Clear pending.** All *done, unconfirmed* items with `completed_at` before the cutoff are listed. The giver approves or rejects each one. Step 2 is blocked until the list is empty. (Pending items completed after the cutoff stay pending for the next period.)
2. **Settle.** For each taker the screen shows the running total and the level reached:
   - total ≥ upper → **upper** level; deduct the upper level's points; remainder carries over;
   - lower ≤ total < upper → **lower** level; deduct the lower level's points; remainder carries over;
   - total < lower → **none**: no pocket money, nothing deducted, everything carries over, no debt.

   Example: lower 50, upper 100, total 130 → upper level, 100 deducted, 30 carries. Total 30 → none, 30 carries.

   The giver confirms; a **settlement record** is written per taker (period, total before, level reached, points deducted, carry-over). The running total never goes negative.
3. **Plan.** Lead into the normal board: open tasks, bidding, and reservations for the coming period. Optionally propose length/levels for the *following* period here (subject to 5.8 agreement).

- Settlements are **final**. Givers and takers cannot edit them. Only the **admin** can correct a settlement, with a mandatory reason; the correction is logged and the original record is preserved.
- **[call]** A correction never rewrites later settlements. It writes a correction record linked to the original (which may state a corrected level reached, for the money paid outside the app) and posts the point difference as an adjustment to the taker's **current** running total. Carry-over is stored per settlement, not recomputed.
- **Manual point adjustments** (outside tasks) are admin-only, need a reason, and are logged.

### 5.11 Disputes (Jakub, 2026-11-16)
- Any **taker or giver** can mark a locked item as **disputed**, with a short reason. Locked items are: an agreed score (task or template), a confirmed or rejected completion, a settlement record, and a manual adjustment.
- A disputed item **keeps its values and state** until the admin resolves it. A dispute blocks nothing else (the meeting and settlement go ahead) **[call]**.
- Only the **admin** resolves a dispute, in one of two ways:
  - **Correct:** a settlement correction or a manual point adjustment (5.9), with the original record preserved;
  - **Dismiss:** leave things as they are, with a note.
- Everyone involved sees the outcome. **[call]** An item has at most one open dispute at a time.
- Opening, correcting, and dismissing a dispute are audit-logged.

### 5.10 Audit log
- **Append-only.** Every state-changing action writes an entry: actor (user), timestamp, action type, entity type and ID, before/after values (or the relevant payload), and optional reason.
- Covers at least: logins (**[call]** success and failure), task/template/instance creation, score offers/counters/approvals/changes, reservations/releases, completions, approvals/rejections, expiries, cancellations, period proposals/agreements, default-setting proposals/agreements, disputes (opened, corrected, dismissed), settlements, admin corrections, adjustments, user and settings changes.
- No UI. It must be queryable by the admin (direct DB access or a simple export is enough).
- **[call]** Domain data is never hard-deleted; cancellation/expiry are states. Running totals must be reproducible from the log + settlement records.

## 6. Authentication and accounts
- Every user logs in. The app is on the public internet, so: HTTPS only, hashed passwords, rate limiting on login, secure session cookies.
- **Accounts live in the database only** (Jakub, 2026-11-17). No config or seed file holds people or password hashes. No self-signup.
- **Admin console** (Jakub, 2026-11-17): a small screen where the admin adds a user (name, role, starting password), renames them, changes their role, deactivates or reactivates them, and resets their password. Every change is audit-logged. Adding Mum later = the admin adds a giver there. No code change.
- Users are never deleted, only deactivated, so their history and audit entries stay readable **[call]**.
- A password reset sets a new password chosen by the admin, who passes it on; the user's sessions end **[call]**.
- **First admin** (Jakub, 2026-11-17): on a database with no admin, the server creates one at boot from the `ADMIN_PASSWORD` environment variable (kept as a deploy secret, never committed). Once an admin exists it is ignored and never changes a password. Dev, PR previews and E2E get their test family from the demo seed instead (Jakub, 2026-11-17): with `TASKMASTER_ENV=preview`, an empty database gets an admin, a giver and two takers with a known demo password. It never runs when `ADMIN_PASSWORD` is set or the database already has people, so production never gets it.
- The v1 auth design must leave room for the **tablet stretch goal**: a shared, logged-in-as-device kiosk where a person taps their name, enters a short PIN, and is logged out after a short idle time.

## 7. User interface
- **Language:** all user-facing labels in Czech. Code, identifiers, DB schema, logs, and commit messages in English.
- **Mobile-first** web app: usable on a phone by a 13-year-old with minimal reading. Big tap targets, few words.
- Main screens (the builder may restructure):
  - **Home / board**: my points (confirmed vs pending vs levels), things waiting for me (score approvals, bids awaiting my reply, completions to approve for givers), my reservations, open tasks/instances.
  - **Task detail**: score, state, bid thread, actions (approve, counter, reserve, done, release).
  - **Log a chore**: pick a template, mark done (self-logged).
  - **Create**: one-time task (giver), template (giver), instance on demand (giver).
  - **Meeting**: the three-step flow from 5.9 (givers).
  - **Period settings**: propose length/levels for an upcoming period, propose a change to the defaults (givers), approve proposals.
  - **Dispute**: mark a locked item as disputed, with a reason (takers and givers).
  - **Admin**: settings, open disputes, corrections, adjustments, people (admin console).
- The UI design (theme, tokens, effects, screen inventory) is in `2026-11-16-taskmaster-ui-design.md`.

Rough home screen sketch (taker):

```
┌──────────────────────────────┐
│ Ahoj, <jméno>                │
│ ██████████░░░░  45 ✔ + 15 ⏳  │
│ spodní 50 · horní 100        │
├──────────────────────────────┤
│ Čeká na tebe (2)             │
│  • Umýt auto – protinabídka  │
│  • Vynést koše – schválit    │
├──────────────────────────────┤
│ Moje rezervace               │
│  • Vysát obývák  10 b        │
├──────────────────────────────┤
│ Volné úkoly                  │
│  • Vyndat myčku   5 b  [Hotovo]│
│  • Vynést tříděný 3 b [Hotovo]│
│ [+ Zapsat udělanou práci]    │
└──────────────────────────────┘
```

## 8. Hosting and constraints
- **Host:** SLNAS, a Synology NAS at the parents' house, owned by Dad. Reachable by Jakub over Tailscale (node share from Dad's tailnet; hostname in private notes). Other services already run on the NAS (ports in private notes).
- **Unknowns to verify first** (they gate the hosting plan): NAS model, DSM version, RAM, whether Container Manager (Docker) is available.
- **Domain:** a subdomain of `slatinsky.cz` (owned by Dad, so DNS changes need his access). Exact subdomain to be chosen with Dad.
- **Exposure:** must be reachable from the public internet with valid TLS. The method (router port-forward + Synology reverse proxy + Let's Encrypt, or an outbound tunnel with no open ports) is **left to the infrastructure plan**, together with Dad's constraints.
- **Footprint:** 3–5 users, so tiny. Prefer a single container and a single-file database (SQLite) to make backup and restore trivial.
- **Backups:** required (anti-goal: data loss). The method is left to the infra plan (e.g. Synology Hyper Backup of the data volume plus a periodic DB dump).
- **Time zone:** Europe/Prague for all schedules, deadlines, and cutoffs.

### 8.1 Facts the infra plan must collect first
These are facts about the family's setup, not design choices. They decide the hosting plan, and only Jakub or Dad can answer them. The infra plan should start by getting them:

1. **SLNAS capability:** model and CPU architecture (ARM vs x86, which affects image builds), DSM version, RAM, and Container Manager support. If it can't run containers, approach A's deployment must be revisited (the app itself is unaffected).
2. **Access:** does Jakub have DSM admin and SSH with sudo, or must Dad perform each step? This decides scripted deploys vs written manual steps.
3. **Public exposure:** is forwarding 443 on the parents' router acceptable to Dad? Is the connection behind CGNAT, and is there a stable public IP or dynamic DNS? Is 443 on the NAS already in use? Is a third-party tunnel (e.g. Cloudflare Tunnel, which may require moving DNS) acceptable?
4. **DNS:** who runs DNS for `slatinsky.cz`, and can Jakub make changes or only Dad?
5. **Off-site backup destination:** a backup kept only on SLNAS does not satisfy the data-loss anti-goal. Where can a copy go (Jakub's machine over Tailscale, a USB disk, another NAS, cloud storage)?

### 8.2 Answers collected (2026-11-16, with Jakub)
Facts only; no spec behaviour changed. Open items are marked **GAP**.

1. **SLNAS capability:** Synology, about 2 GB RAM (from Jakub's memory, unverified). Has a container manager, believed to be Docker (Synology Container Manager). **GAP:** model, CPU architecture, DSM version. SLNAS was unreachable on 2026-11-16. Jakub's vault note on SLNAS records access and ports only. Note: Incus (used on Jakub's Pi) cannot run on DSM, so the container choice is Docker via Container Manager or bare DSM; Docker preferred. To fill the gap, run over SSH: `uname -m; cat /etc.defaults/VERSION; cat /proc/sys/kernel/syno_hw_version; free -m; sudo docker version`.
2. **Access:** Jakub has access to SLNAS and expects to deploy himself (scripted deploys). **GAP:** confirm DSM admin and SSH with sudo once reachable.
3. **Public exposure:** not yet asked of Dad (router forward, CGNAT, public IP). Jakub plans to take over `slatinsky.cz` from Dad and to use Cloudflare for a separate résumé site. **Decided (Jakub, 2026-11-16): option A.** Move `slatinsky.cz` DNS to Cloudflare (free plan, full zone) and expose Taskmaster from SLNAS through a Cloudflare Tunnel (`cloudflared` container, outbound only), so no router forward, no public IP needed, and no clash with NAS ports 80/443. Rollout: import existing records as DNS-only, check against the WEDOS zone export, switch nameservers, then add the tunnel. Cloudflare terminates browser TLS and re-encrypts into the tunnel; it can see request contents. Cloudflare Access (email-code gate) is an optional extra layer. Rejected: router forward + Synology reverse proxy (opens NAS, needs Dad's router), VPS reverse proxy over Tailscale (touches Dad's business server), Tailscale Funnel (no custom domain). Ports on SLNAS (Dad's question) no longer matter for exposure.
4. **DNS and the domain server:**
   - `slatinsky.cz` web is served by a **WEDOS VPS** (address and access details in private notes), reached by SSH with Dad's account. Small and dated (1 vCPU, 2 GB RAM, little free disk). No Docker, no Tailscale, no DNS server on it.
   - Apache on 80/443 serves: `slatinsky.cz` + www (static site) and **Dad's company website** (a separate domain), plus admin tooling. Details in private notes.
   - No `slatinsky.cz` subdomains are configured on the VPS today.
   - DNS is most likely hosted at WEDOS (no DNS server on the VPS). **GAP (postponed):** Jakub can't log in to WEDOS yet; the full `slatinsky.cz` zone (MX and other records) must be exported before any nameserver move.
   - Constraint: nothing done for Taskmaster may affect Dad's company site. It is a separate domain, so a `slatinsky.cz` nameserver move does not touch its DNS.
   - Not recommended as Taskmaster's host (EOL OS, low disk, shares the box with Dad's business site).
   - Subdomain for Taskmaster: **`taskmaster.slatinsky.cz`** (Jakub, 2026-11-16).
5. **Off-site backup:** **deferred to post-v1** (Jakub's explicit call, 2026-11-16). v1 keeps local backups on SLNAS only; the infra plan should still make the backup easy to copy off-site later.

## 9. Approaches considered

| Approach | Pros | Cons |
|---|---|---|
| **A. Small custom web app** (one server + SQLite, one Docker container on SLNAS, mobile-first, PWA-ready) | Enforces the family's exact rules (bidding, all-party approval, periods, settlement, append-only log); tiny footprint; one-file backup | Built from scratch |
| B. Adapt an existing self-hosted chore app (Grocy, Donetick, …) | Recurrence and basic points for free | None found that does bidding, all-party score agreement, or period settlement; would mean forking and fighting a foreign model; Czech translation work anyway |
| C. No-code (Google Sheets + AppSheet, Notion) | Fastest first version | Not on SLNAS; approval rules and audit log would be leaky; external dependency, which works against self-hosting |

**Chosen: A** (owner decision, 2026-11-16). The rules are the point of the app, and only a custom app enforces them properly.

## 10. Left to the builder
- ~~Language, framework, and libraries~~ → decided in section 11.
- Data model and schema, including how the audit log is stored.
- Auth implementation (within section 6).
- Scheduler mechanism for scheduled instances and expiry.
- Exposure method, reverse proxy, TLS, and backup mechanism (infra plan).
- Test strategy. The rules in section 5 (agreement, lifecycle, settlement arithmetic, period attribution) deserve thorough automated tests.
- Exact screen structure and visual design within section 7 (see the UI design doc).

## 11. Tech stack (decided 2026-11-16, with Jakub)
Jakub prefers TypeScript and React and wants to explore TanStack. Next.js was rejected because its best features depend on Vercel-style hosting, and SvelteKit and Go because they are less familiar to him. Items marked **[call]** are Claude's defaults that the owner may still overturn.

- **App:** [TanStack Start](https://tanstack.com/start) v1 (React, TypeScript, Vite). TanStack Router handles typed routes and loaders, and server functions provide the API, so no separate backend is needed. TanStack Query and TanStack Form are used where they help. The app runs as one Node server (Nitro `node-server` preset) in one container.
- **Domain layer [call]:** the section 5 rules live as plain TypeScript (state machines and settlement arithmetic) with no framework imports. Server functions are thin wrappers around it. This keeps the rules easy to test, and the framework could be swapped if Start disappoints.
- **DB:** SQLite in WAL mode, a single file on a mounted volume. Drizzle ORM with versioned migrations, driver `better-sqlite3` [call]. The audit log is an append-only table, written in the **same transaction** as each domain change.
- **Passkeys (Jakub, 2026-11-16):** users can log in with Face ID / Touch ID / Android fingerprint or the phone's screen lock via WebAuthn passkeys (`@simplewebauthn/server` + `@simplewebauthn/browser`). Relying-party ID `taskmaster.slatinsky.cz`. Flow: the first login uses the admin-seeded password, then the app offers "Přihlásit otiskem / obličejem" to register a passkey; later logins are one tap. Passkeys sync via iCloud Keychain / Google Password Manager. Password stays as a fallback. A user may hold several passkeys (one per device). Passkey registrations and removals are audit-logged. Not used for the shared tablet (stretch), which keeps name+PIN.
- **Sessions [call]:** long-lived (about 90 days, sliding) on personal phones, so logging in is rare anyway.
- **Auth [call]:** own small session auth, no auth framework. Passwords hashed with argon2id (`@node-rs/argon2`), random session tokens stored hashed in the DB, cookie `HttpOnly; Secure; SameSite=Lax`, login rate limit per user and IP kept in SQLite. The tablet name+PIN mode (stretch) becomes a second login method on the same session table. No Cloudflare Access gate in v1, because it adds too much friction for the 13-year-old.
- **Scheduler [call]:** in-process `croner` with zone Europe/Prague. It creates scheduled instances, expires deadline instances, and rolls periods. Jobs are idempotent and catch up on boot after downtime.
- **PWA [call]:** v1 ships a web manifest and a small service worker (app shell cache only, no offline writes), so the app is installable. Push notifications (stretch) come later via `web-push` with VAPID keys; on iOS they need the app added to the home screen.
- **UI:** Tailwind CSS v4 (Jakub, 2026-11-16; chosen for maintainability over plain CSS). The Hřiště/Pastelky tokens from the mockups (`/ui-design/` in the project files) go in `@theme` as CSS variables, with light and dark modes following the system. Keyframes and gamified effects live in one small CSS file; `canvas-confetti` handles confetti. Components: **shadcn/ui** (Jakub, 2026-11-16), copied into the repo so we own and restyle them; its CSS variables are mapped to the Hřiště/Pastelky tokens, so it must not keep the default neutral look. Likely set [call]: Button, Card, Badge, Progress (XP bar), Drawer (mobile bottom sheets for task actions), Dialog, Tabs, Sonner (toasts), form inputs, Input OTP (tablet PIN later). Czech strings are kept in one module [call].
- **Dates [call]:** all schedule, cutoff, and deadline maths in Europe/Prague via one helper module (`date-fns` + `@date-fns/tz`); UTC instants are stored in the DB.
- **Tests [call]:** Vitest for the domain layer, heavy on section 5 (agreement, lifecycle, period attribution, settlement). A few Playwright end-to-end flows (login, task → bid → done → approve, meeting).
- **Code quality [call]:** TypeScript `strict` (plus `noUncheckedIndexedAccess`). ESLint flat config with `typescript-eslint` strict type-checked rules (catches floating promises in server functions), `eslint-plugin-react-hooks`, and `@tanstack/eslint-plugin-query` + `@tanstack/eslint-plugin-router`. Prettier with `prettier-plugin-tailwindcss` (sorted classes). A pre-commit hook (`lefthook`) runs format + lint on staged files. CI runs typecheck, lint, format check, and tests on every push; the image is built only when they pass. Biome was considered (one fast tool) but lacks the TanStack plugins and most type-aware rules.
- **Build and ship [call]:** pnpm, Node 22 LTS image. GitHub Actions builds a multi-arch image (amd64 + arm64, via `buildx`) and pushes it to GHCR, so the unknown SLNAS CPU arch doesn't block anything. The NAS pulls the image. Expected RAM use is about 100 MB.
