# PRD — Fineduc

> **Product Requirement Document.** What we are building, who it is for, and what the product
> actually needs to do. Product-level only — no technology decisions. Technology lives in
> [ARCHITECTURE.md](ARCHITECTURE.md).

- **Status:** v1 draft, pre-code
- **Owner:** founder
- **Last updated:** 2026-08-18

---

## 1. Problem

Private schools in francophone and anglophone Africa run on a broken fee-collection loop.

| Symptom | What it costs the school |
|---|---|
| **Chasing fees by hand** — the bursar calls parents one by one, class list in hand | Weeks of staff time per term; collection depends on one person's memory |
| **Late payments** — no schedule the parent can see, no reminder before the due date | Cash arrives after salaries and suppliers are due; the school borrows to bridge |
| **Untracked cash** — parents pay in banknotes at the desk, receipt book is a carbon pad | Money leaks between the desk and the safe; nobody can prove what was collected on a given day |
| **Millions never recovered** — arrears roll from term to term, then year to year | At year-end the school writes off a large share of what it was owed |
| **The director is blind** — the real position is known only after a manual month-end reconciliation | Decisions (hiring, works, salaries) are made on a number that is weeks stale |

The root cause is not fraud and not laziness. It is that **the fee ledger only exists on paper
and in one person's head**, so nothing about it can be scheduled, reminded, reconciled, or seen
in real time.

## 2. Solution

**Fineduc gives every student a file, every fee a due date, and every payment a trace.**

Four moves, in the order they unlock value:

1. **A file per student** (*un dossier par élève*) — one record holding the student, the
   guardians who pay, what is owed, what has been paid, what remains. Replaces the register,
   the receipt book and the bursar's memory.
2. **Instalments** (*des échéances*) — the year's fees split into dated tranches the moment
   the student is enrolled. The parent knows the amount and the date in advance.
3. **Automatic reminders** (*rappels automatiques SMS / WhatsApp*) — the system messages the
   guardian before the due date, on the due date, and after. Nobody has to remember.
4. **Mobile money payment** — the parent pays from the phone that received the reminder,
   through a **third-party payment aggregator** (never a direct telco integration).
   Reconciliation is automatic because the payment arrives already attached to a student.

And the outcome the buyer actually pays for:

5. **The director sees everything, in real time** (*le directeur voit tout en temps réel*) —
   collected today, expected this month, arrears by class, cash desk status, all live.

### Positioning

> **Fineduc — the school fee ledger that collects by itself.**
> *Un dossier par élève, des échéances claires, des rappels automatiques, le paiement mobile
> money. Le directeur voit tout en temps réel.*

## 3. Who it is for

### Buyer / champion — **the Director / Proprietor** (*Directeur, Promoteur, Fondateur*)
Owns the P&L. Feels the pain as a cash-flow number. Buys because of the real-time view and the
recovery rate. **Rarely opens a computer — decides from a phone.**
Success = *"I know my position without asking anyone."*

### Daily driver — **the Bursar / Accountant** (*Économe, Comptable*)
Lives in the product 4+ hours a day. Enrols students, builds fee schedules, allocates payments,
closes the cash desk, chases arrears. Will kill the product if it is slower than their
notebook. Success = *"I closed the desk in five minutes and it balanced."*

### Cashier (*Caissier*)
Takes cash and issues receipts at the desk. Often junior. Needs three taps, not thirty.
Success = *"receipt printed, parent gone."*

### Payer — **the Guardian** (*Parent, Tuteur*)
**Never logs in.** Receives WhatsApp/SMS, taps a link, pays with mobile money, gets a receipt
back on the same thread. Frequently: low literacy, shared phone, several children in the
school, pays in irregular slices as income allows.
Success = *"I paid without going to the school."*

### Not our user in v1
Teachers, students, ministry inspectors. No grades, no attendance, no timetable. **Fineduc is
not a school management system.** It is a fee-recovery system. This boundary is the product.

## 4. Scope

### v1 — must ship

#### Student file
- Student record: identity, photo, class, academic year, status (enrolled / left / graduated)
- Guardians attached to a student, each with a phone number, a relationship, and a
  `pays_fees` flag; one guardian may hold several students
- Enrolment (*inscription*) into a class for an academic year — the act that creates money owed
- Re-enrolment for the next year, carrying the outstanding balance forward
- Sibling linkage (same guardian → one consolidated view, one message)

#### Fees and instalments
- Fee schedule (*grille tarifaire*) per class per academic year, composed of fee items:
  tuition (*scolarité*), registration (*frais de dossier*), exam, canteen, transport, uniform,
  boarding — each recurring or one-off
- Instalment plan (*échéancier*): the year's total split into dated tranches (typically three,
  configurable per school and per class)
- Discounts and scholarships: sibling, staff-child, merit, hardship — percentage or fixed
  amount, applied at fee-item or student level, and **always attributable to whoever granted it**
- Per-student payment arrangement (*arrangement*) overriding the class plan, with an approval trail

#### Payment
- **Mobile money via a third-party aggregator** — MTN MoMo, Orange Money, Moov, Wave, card,
  all reached through one aggregator account. Fineduc holds **no** direct telco contract and
  **no** licence.
- Cash at the desk, always inside a cash session (below)
- Bank transfer / cheque, recorded manually with a reference
- **Partial payment is the norm, not the exception.** A parent paying 12 000 against a 45 000
  instalment must be a first-class, one-tap operation
- Allocation: a payment settles the oldest instalment first by default, with manual override
- Receipt on every payment — numbered, immutable, re-sendable to the guardian
- Overpayment becomes a credit balance carried to the next instalment
- Refund and reversal — restricted, reason-coded, dual-approval, never a delete

#### Cash control — the answer to *espèces mal tracées*
- Cash session: a named cashier opens a desk with a declared opening float, takes payments,
  closes with a declared count
- The system computes expected cash, shows the variance, and **requires a reason for any variance**
- A session cannot be reopened after close; corrections are new, signed entries
- Daily cash report per cashier, per desk, per day — the artefact the director reviews

#### Reminders
- Reminder rules per school: offsets relative to the instalment due date (D-7, D-2, D-day,
  D+3, D+10, D+30), each with a channel and a template
- Channels: **WhatsApp first** (cheap, rich, threaded), **SMS fallback** (universal, works on
  feature phones with no data)
- Templates in French and English, per school, with variables (`{parent}`, `{eleve}`,
  `{classe}`, `{montant}`, `{echeance}`, `{lien}`) and a school signature
- Every reminder carries a **payment link** — tap, pay, done
- Escalation ladder: gentle → firm → formal notice, tone set by the school
- Quiet hours, per-guardian frequency cap, immediate stop on payment
- Opt-out honoured and recorded
- Full message log: sent, delivered, read, failed, cost — visible to the bursar
- Manual send: to one guardian, one class, or a filtered debtor list

#### Director dashboard, real time
- Collected today / this week / this term, against expected
- Recovery rate for the term and for the year
- Arrears (*impayés*) ranked by class, by amount, by age bucket (0-30 / 31-60 / 61-90 / 90+ days)
- Cash desk status right now: open sessions, cashier, amount held
- Payment-method mix (mobile money vs cash vs transfer) — the number that proves cash is shrinking
- Reminder performance: sent, delivered, and amount collected within 72h of a reminder
- **Mobile-first.** The director looks at this on a phone, standing up. Design for that first.
- Export to Excel/PDF for the board, the auditor, the bank

#### Administration and security
- Multi-tenant: one school = one tenant, hard-isolated. A group with several campuses is one
  tenant with several sites.
- Roles: Director, Bursar, Cashier, Secretary, Read-only (auditor). Least privilege by default.
- Two-factor for Director and Bursar
- Append-only audit log on every money-touching and permission-touching action — who, what,
  before, after, when, from where
- Academic year lifecycle: open → active → closed. A closed year is read-only.
- Full data export owned by the school

### v1.1 — next, not now
Parent self-service portal · standing orders / auto-debit · bulk enrolment import from Excel ·
offline-capable cashier mode · payment-plan simulator · WhatsApp inbound (parent replies
"solde", gets their balance) · USSD/IVR balance check.

### Explicitly out of scope
Grades, attendance, timetable, payroll, library, transport routing, HR, e-learning, a general
ledger, direct telco payment integration, and holding funds. **Fineduc is never a payment
institution** — money moves aggregator → school account, never through us.

## 5. Constraints that shape everything

These are not footnotes. They are the design.

- **The currency has no decimals.** XAF and XOF are ISO-4217 exponent **0**. There are no
  centimes. Every money value is an integer of the currency itself. Any float, any
  `amount * 100`, any two-decimal display is a bug.
- **The network is bad.** 2G/3G, dropped requests, duplicate submissions. Every write that
  moves money must be idempotent. The cashier *will* press the button twice.
- **Phone numbers are the identity.** Guardians are reached by phone, not email. Numbers are
  shared between households, change often, and are entered inconsistently (`+237 6xx`, `06xx`,
  `2376xx`). Normalise to E.164 on the way in, always.
- **Messaging costs real money.** Every SMS is a cost line; WhatsApp utility conversations are
  far cheaper. Reminder volume must be capped, budgeted and visible — a runaway loop is a
  financial incident, not just a bug.
- **Payment confirmation is asynchronous and unreliable.** The aggregator's webhook may arrive
  late, twice, or never. Never trust the browser redirect. The webhook is authoritative;
  polling reconciliation is the safety net.
- **Two languages, one product.** French-first UI, English available. Templates in both.
- **Low-end Android, small data budget.** The dashboard must be usable on a three-year-old
  phone over 3G.
- **Trust is the sale.** These schools have been burnt by software vendors and by staff. The
  audit trail and the cash reconciliation are not compliance features — they are the demo.

## 6. What success looks like

| Metric | Target by end of first full term |
|---|---|
| Collection rate at term end | +15 points vs the school's previous term |
| Share of fees paid by mobile money | > 40% (from ~0) |
| Cash desk variance | < 0.5% of cash collected, every variance reasoned |
| Bursar time spent chasing | −60% self-reported |
| Amount collected within 72h of a reminder | tracked, reported, used in the sales pitch |
| Director dashboard opened | ≥ 4 days a week |
| Reminder delivery rate | > 95% |

Anti-metric, watched weekly: **messaging cost per 1 000 XAF collected.** If it rises, the
reminder ladder is wrong.

## 7. Pricing

Priced off what a school actually recovers, and off what it costs us to serve them.

### Cost floor per school per month
- Infrastructure (shared): ~2 000–4 000 XAF
- WhatsApp utility conversations: ~3–15 XAF each
- SMS: ~15–25 XAF each — **the dominant variable cost**
- Payment aggregator: 1.5–3.5% of value, **paid by the payer or the school, never absorbed by us**
- Support and onboarding, amortised: ~10 000–20 000 XAF

A 300-student school on a three-reminder ladder generates ~900 messages/month. All-SMS that is
~18 000 XAF. **This is why messaging is a metered wallet, not an unlimited inclusion.**

### Model: platform subscription (sized by enrolled students) + prepaid message wallet

| Plan | For | Price | Included |
|---|---|---|---|
| **Essentiel** | up to 250 students | **25 000 XAF / month** *(~$40)* | Student files, instalments, cash sessions, mobile money, director dashboard, 2 staff + 2 cashiers, **500 WhatsApp msgs/mo** |
| **Croissance** | 251–800 students | **60 000 XAF / month** *(~$100)* | Everything, unlimited users, escalation ladder, multi-desk cash control, Excel/PDF export, **2 000 WhatsApp msgs/mo**, priority support |
| **Institution** | 800+ / multi-campus | **from 120 000 XAF / month** | Everything, multi-site consolidation, custom templates, API access, named account manager, on-site onboarding |

**Annual, paid up front: −20%.** This matches how schools budget — they pay once, at the start
of the year, out of registration income. Expect most revenue here.

**Message wallet** — prepaid credits, never a surprise bill:
- WhatsApp **10 XAF** / message · SMS **30 XAF** / message
- Packs: 10 000 msgs for 85 000 XAF · 50 000 msgs for 375 000 XAF
- The school sets a monthly cap. At the cap, sending stops and the bursar is warned.

**One-off onboarding: 150 000 XAF** — migration from the existing registers, fee-schedule
setup, two staff training sessions. Waived on an annual Croissance or Institution contract.
This is not a margin line; it is the thing that makes the school actually adopt.

**Aggregator fees are passed through**, configurable per school: charged to the parent
(default) or borne by the school. Fineduc never touches the money and never nets a fee out of it.

### Sanity check
A 400-student school charging 250 000 XAF/year collects 100 000 000 XAF. Croissance annual is
576 000 XAF — **0.58% of collections.** Recovering even 3% more arrears returns 3 000 000 XAF.
The pitch is one sentence: *you pay us out of what we recover for you.*

### Deliberately not doing
Percentage-of-collections pricing (feels like a tax, invites disputes, drags us toward
payment-institution regulation) · a free tier (these are businesses; free attracts schools that
never adopt) · per-user seats (punishes the cashier count, which we want high).

## 8. Landing page

Marketing site for African private schools. French-first, English toggle.

**Design reference:** the FintechX Framer template mirrored in `D:\mes site\fineduc`.
Dark `#1d1d1d` on off-white `#edf1f4`, slate body `#4d585f`, accent blue `#3b82f6`, positive
emerald `#10b981`, Inter throughout. Generous whitespace, large rounded cards, soft shadows,
scroll-triggered reveals, sticky-scroll step stacks, a live-looking dashboard mock as the hero.
Calm, financial, credible — **not** a colourful edtech look. These buyers need to see a bank,
not a school.

**Section order**

1. **Hero** — *"Arrêtez de courir après les frais de scolarité."* Sub: one file per student,
   automatic reminders, mobile money payment, real-time view. CTAs **Demander une démo** /
   **Voir le tableau de bord**. Trust strip: schools using it · students managed · amount recovered.
2. **Avant / Après Fineduc** — the template's before/after toggle, carrying our five pains and
   five fixes.
3. **Core features** — student file, instalments, reminders, mobile money, cash control,
   director view.
4. **Director dashboard showcase** — the real screen, on a phone. This is the money shot.
5. **How it works**, three sticky steps — *Import your students → Set your fee schedule →
   Reminders and payments run by themselves.* "Live in 48 hours."
6. **Security and trust** — audit trail, encryption, the data belongs to the school, no funds
   held, role separation. Written to convince a suspicious director.
7. **Who it is for** — nursery/primary, secondary, bilingual, technical, multi-campus groups.
8. **Numbers** — recovery-rate lift, cash-share reduction, time saved. Real ones, once we have them.
9. **Testimonial** — one director, named, with a number.
10. **Pricing** — three plans, annual toggle, wallet explained plainly.
11. **FAQ** — Do you touch our money? (no) · Which mobile money operators? · Does it work when
    the internet is down at the desk? · Can parents pay in slices? · We already use Excel — why
    change? · Who owns the data?
12. **Final CTA + footer.**

Pages: `/` · `/fonctionnalites` · `/tarifs` · `/securite` · `/demo` · `/contact` · `/blog` ·
`/legal/*`. A WhatsApp contact button on every page — that is how these buyers get in touch.

## 9. Hard questions

*Asked of the plan before writing code. The answers are kept here because they are requirements.*

### What will break?

- **Reconciliation drift.** The aggregator says paid, we say pending, the parent has a
  confirmation SMS and is standing at the desk. → The webhook is authoritative; a scheduled job
  re-queries every non-final payment; a manual "force reconcile" exists and is audited.
- **Double payment.** Bad network, parent taps twice, two debits. → Idempotency key on every
  initiation, keyed to student + instalment + amount + a short window; automatic detection of
  duplicate settlements and a one-tap refund path.
- **The reminder storm.** A bug, a retry loop, or a bad rule messages 3 000 guardians at 02:00.
  Simultaneously a money loss, a trust loss, and possibly the end of the contract. → Hard
  per-tenant daily cap, quiet hours enforced at the *send* layer (not the scheduler),
  per-guardian frequency cap, kill switch, and every send debited from a visible wallet.
- **Reminding someone who already paid.** The fastest way to lose a school. → Reminder state is
  resolved at send time against the live balance, never at schedule time.
- **A wrong phone number.** The number belongs to a stranger, or to a guardian who left — and
  now a stranger receives a debt notice naming a child. That is a privacy incident. → Number
  validation, failure tracking that quarantines a number after N bounces, and guardian
  confirmation before the first send.
- **A cash session never closed.** The cashier goes home. → Auto-flag at end of day, escalate
  to the bursar, block the next session on that desk.
- **Timezone and due-date arithmetic.** "Due today" computed in UTC fires reminders a day
  early. → Every tenant has a timezone; every due date is a calendar date in tenant time, never
  a timestamp.
- **Mid-year fee changes.** The school raises fees in January; some students already have
  instalments. → Fee schedules are versioned and effective-dated; existing instalments are
  never silently mutated — a change creates an adjustment line.
- **The bursar who does not trust it.** Runs the notebook in parallel for a term, then the two
  disagree. → Import their notebook on day one; make the daily cash report match their format.
- **Aggregator outage on the last day of term.** Peak day, provider down. → Cash and transfer
  paths never depend on the aggregator; queue and retry initiations; show status honestly to
  the bursar.

### What edge cases are we missing?

Student leaves mid-year holding a credit balance · a guardian pays for three children in one
transfer · two guardians pay the same instalment at the same moment · a payment arrives for a
student who was never enrolled (wrong reference) · sibling discount when one sibling withdraws ·
the academic year is closed but a late payment arrives for it · a guardian phone shared by two
families · a partial refund on a partially-allocated payment · a school changing its instalment
count mid-year · a cashier who is also a guardian · a payment in a currency other than the
tenant currency · a student enrolled in two schools of the same group.

### What is over-engineered?

Cut from v1, deliberately: a parent-facing portal (**WhatsApp is the portal**) · a full
double-entry general ledger (a student ledger plus a cash ledger is enough — we are not the
accountant) · a rules engine for reminders (a fixed offset ladder covers every school we have
spoken to) · offline-first sync (a slow online desk beats a wrong offline one — revisit in v1.1
with real data) · microservices (one deployable, clean modules) · multiple aggregators on day
one (one, behind a port; a second when a real school demands it) · in-app chat, an analytics
warehouse, ML arrears prediction, and a native mobile app (the dashboard is a good web app).
