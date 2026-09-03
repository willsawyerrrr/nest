# CLAUDE.md

## Purpose

Household budgeting app for two people: income tracking, full AU income-tax
modelling, spending plans, and savings goals. See [`README.md`](README.md) and
[`docs/`](docs/) for scope and design.

## Fixed scope decisions

- Platform: one PWA for both iOS (installed via Safari) and web. No native app.
- Backend: Supabase (Sydney, Pro) — Postgres, Auth, PostgREST, Edge Functions,
  Vault. Direct PostgREST + RLS for CRUD; edge functions for tax engine + Up sync.
  Schema migrations under `supabase/migrations/` auto-deploy to prod on merge to
  `main` via `.github/workflows/deploy-migrations.yml` — nothing is applied by
  hand. Prod having applied every migration in the directory is asserted, not
  assumed: `.github/workflows/check-migration-drift.yml` compares the two every
  six hours, and the deploy workflow re-runs the same check straight after its
  push (see [`docs/operations.md`](docs/operations.md#deployment)).
- Frontend: React PWA (TypeScript); one frontend for iOS + web.
- UI framework: Mantine (React components + theming) under a dark-first design
  system (custom brand/semantic colour scales, shared primitives, tokenised
  charts — see [`docs/design-system.md`](docs/design-system.md)). The app is
  designed mobile-first — the primary device is an installed iPhone PWA.
- Frontend hosting: Vercel (Root Directory `apps/pwa`, Vite preset); auto-deploy
  on merge to `main`, preview deploys per PR.
- Auth: Supabase Auth via Google OAuth (consent screen published).
- Language: TypeScript across PWA and edge functions; tax engine is a shared
  package.
- Household & money: the two partners share ONE household with money fully
  pooled — no multi-household UI (no picker or switcher), no per-person budgets
  or splitting. All household members manage the shared planning data, and record
  attribution to a member is a tax/reporting tag, not a permission. `household_id`
  + RLS isolate the household's data from all other Supabase users; within the
  household, membership gates the shared and own data, with a per-account
  balance-privacy boundary on top — a member sees balances and transactions only
  for shared/joint, own, and household-super accounts, a co-member's spending
  account is visible by NAME ONLY (for routing) and their savers not at all, so a
  net-worth view sums only visible balances. Balances live in `account_balance`,
  split out of the identity `accounts` table so both account surfaces —
  `account_directory` (identity only) and `accounts_with_balance` (identity plus
  balance) — are plain invoker views needing no SECURITY DEFINER; the
  helper-function and view mechanics behind this live in architecture.md
  (Security) and data-model.md (the ledger tables, `account_directory`, and
  `accounts_with_balance`). A partner joins via a temporary, opt-in, single-use
  invite code (`create_invite_code` mints one, `join_household` redeems and
  consumes it, `revoke_invite_code` clears it); no email infrastructure.
- Inflows: the household owns many projection-based inflows, split by taxability
  — taxable income (salary, wage, or other regular income on a schedule — weekly
  through annual, or an arbitrary every-N-weeks or every-N-months cadence — each
  tagged to a member
  for tax) and non-taxable inflows (reimbursement, hobby income, gift, or other —
  the type is a reporting label, excluded from tax and added to available cash).
  **An inflow is either RECURRING or a ONE-OFF, and says which.** It states the
  cadence it recurs on (`schedule`) or the single date it lands on (`paid_on`),
  never both and never neither. A one-off is money that arrives once — severance,
  a bonus, a gift from a relative — which no cadence can say: given `annual` and
  an amount, every reader treats the money as arriving each year, so the
  fortnightly budget smears it into the buffer, a pay split routes a share of it,
  and a payslip period is measured against a slice of it, reporting a household as
  permanently ahead and then permanently behind. So a one-off carries none of the
  cadence machinery — no interval, no separate pay cadence, no effective dates —
  is never a `wage` (an amount paid once prices no hours), and is annualised as its
  whole amount in the financial year its date falls in and as nothing in any other.
  Nothing per-period is derived from it: it is excluded from the fortnightly budget
  figures and from pay splits, and no payslip period holds an expectation for it —
  the year is where it is read, in the same block as pay arriving in only some
  periods (see Payslips). The Summary reports the year's one-off money as its own
  annual figure BESIDE the plan rather than inside `available`, because dividing a
  payment that lands once into a fortnightly figure would raise the buffer for all
  26 fortnights on the strength of one. A TAXABLE one-off also states how it is
  taxed (`one_off_tax_treatment`), a genuine redundancy carrying the completed
  `years_of_service` its tax-free amount is priced from; see Tax.
  **How an amount is expressed and how often it arrives are separate facts, and
  both are stored.** `schedule` + `amount_cents` are the amount and the period it
  covers, so a salary defined as an annual number is `annual` + `130_000_00`
  losslessly however often it is paid; the nullable `pay_schedule` +
  `pay_interval_count` carry the cadence the money lands on, null meaning it lands
  on the frequency the amount is expressed in. The form asks the two questions
  separately, defaulting the second to the first so the simple case is unchanged,
  and shows back the per-payment figure it derives. Annualising always reads
  `schedule` — the FY tax estimate, its effective-date proration, the budget's
  fortnightly/annual normalisation, and pay splits all do. The pay cadence sets
  only the pay cycle a payslip's period is measured against, so a 14-day slip
  against a fortnightly-paid $130,000 salary is one whole turn expecting exactly
  $5,000.00 rather than part of a 365-day turn expecting $4,986.30. A per-payment
  figure is derived, never stored, and rounds to the nearest cent, so a year of
  payments can sit a few cents either side of the annual figure; the form names
  the gap where there is one. Salary or wage money arriving once a year draws an
  advisory note pointing at the pay-cadence picker, which never blocks a save.
  A recurring inflow, taxable or non-taxable, may carry optional
  effective-from/until dates (`starts_on` / `ends_on`); blank either side is
  open-ended and blank both means the whole financial year. The two sides read
  the window differently by design: the FY tax estimate prorates a taxable
  inflow's rate by its active share of the year (by calendar days), so income
  that changes mid-year — a pay rise modelled as the old rate ending and a new
  dated inflow starting — is estimated correctly, whereas the fortnightly budget
  gates a non-taxable inflow fully in or out by whether it is active at `now`,
  counting it at its full fortnightly/annual rate within the window and excluding
  it entirely outside, the same way a temporary item drops out of the buffer once
  it expires.
  A taxable inflow also records whether it is ordinary time earnings
  (`attracts_super`, default true). An allowance paid on top of ordinary hours —
  on-call or standby pay, each tier its own inflow — is taxed in full but earns
  no employer super, so it is excluded from the SG and percent-of-salary bases
  and from a payslip's expected super. It is NOT excluded from the super
  co-contribution's income test, which is on total assessable income: an
  allowance is assessable in full, so the two bases are computed separately and
  leaving it out would over-state the entitlement. The flag touches super only;
  taxability is unaffected. A taxable inflow also records whether its money lands
  in EVERY turn of its pay cadence (`arrives_every_pay_period`, default true). On-call
  pay is paid on the fortnightly payrun but only for the fortnights a shift was
  worked, which no cadence can say — a cadence claims the money arrives every turn —
  so a smoothed per-period figure reports pay off plan in whichever direction the
  fortnight fell, neither being real. The household chose per-period payslip totals
  and no roster, so the app cannot know which fortnights carry a shift and stops
  pretending it does. Projections are untouched: on-call worth $6,600 a year is
  $6,600 of assessable income and $253.85 a fortnight of projected cash either way.
  What changes is a payslip period, which holds NO expectation for such an inflow
  (see Payslips).
- Tax: full AU income tax, versioned per financial year; estimate-only
  (actual-paid tracking deferred), per-person, modelling HELP debt and
  private-hospital cover; target financial year FY2027. Each member's HELP/HECS
  balance is a single standing figure (the `help_debt` table, not FY-scoped),
  edited on its own HELP debt tab, that feeds the tax estimate and counts as a
  net-worth liability. A taxable ONE-OFF is assessed under the concession its
  treatment names rather than as ordinary salary, which would overstate a
  redundancy by thousands: a genuine redundancy's tax-free amount (a base limit
  plus a per-year amount for each completed year of service) is excluded from
  assessable income entirely and its excess is an excluded ETP capped by the ETP
  cap alone; a non-excluded employment termination payment is capped at the lesser
  of that cap and the whole-of-income cap net of the member's other taxable
  income; unused leave paid out on a redundancy is assessable in full with the tax
  on it capped at a flat maximum rate; and ordinary income is assessable in full.
  The concession is delivered as an OFFSET, never by holding the payment out of
  income: the assessable part joins taxable income like any other — lifting the
  LITO taper, the Medicare levy, the surcharge, HELP repayment income, and
  Division 293, all of which assess taxable income — and the offset brings the
  effective rate on the concessional part down to its capped rate by the ATO's
  difference method, applied alongside LITO and floored with it, so it can never
  create a refund on its own and leaves the Medicare levy untouched (the config's
  rates therefore EXCLUDE the levy, which is why they read 2% under the commonly
  quoted figures). The ETP rate turns on the member's age at the payment date, so
  `members.date_of_birth` — optional, entered on the Home tab beside their tax
  profile — is tested against the year's preservation age; unset reads as below
  it, the higher rate. **The annual and fortnightly figures deliberately disagree
  about one-off money**: the annual ones are whole-year truths that include it,
  the fortnightly ones are derived net of it, and the estimate reports the
  one-off gross and its own after-tax value separately so the gap is named rather
  than read as a bug.
- EOFY summary: a read-only filing-prep tab (`/eofy`) that gathers the
  household's already-tracked tax data — the tax estimate, the payslips' actual
  PAYG withheld, deductions, super contributions, and HELP debt — into one
  per-member view for a financial year picked from a selector built from the tax
  engine's published configs, so the selector scales as future FY configs are
  added. Every source is scoped to the selected year, payslips included, so the
  estimate's balance is that year's real refund or bill rather than a liability
  with nothing paid against it — the same figure the Tax tab shows for the same
  rows, in the same words. It aggregates existing data
  only: no new tables, no actual-paid-tax tracking, and no checklist state. Each
  member's card condenses their filing-relevant tax figures, states the withheld
  total and the number of payslips behind it (a year with no payslips says so,
  rather than reading as a year that withheld nothing), lists their claimed
  deductions with receipts, shows their super contributions against the same
  cap warnings as the Super tab, and shows their standing HELP balance with the
  year's estimated repayment; nothing on the tab is editable.
- Tax deductions: each member owns many deductible expenses on their own Tax
  deductions tab (the `deduction` table, FY-scoped), each an amount and date
  tagged to a member. A deduction reduces that member's taxable income in the
  tax estimate — so their estimated tax falls and take-home rises — appearing as
  a Deductions line in the Tax tab's income build-up and flowing through to the
  Summary. `amount_cents` is always the figure saved and read downstream; a
  deduction states its `basis` (`amount`, the default, or `distance`) to say how
  that figure was arrived at. A work-related car expense claimed under the ATO's
  cents-per-kilometre method is entered as `distance_km` kilometres instead of a
  dollar figure: the form computes and shows back `amount_cents` from the
  deduction's own financial year's published cents-per-km rate
  (`@nest/tax`'s versioned `carExpense` config, read by `carExpenseDeductionCents`)
  and that figure — not the distance — is what is saved, the same
  snapshot-at-write-time pattern `payslip_line.attracts_super` follows so a later
  change to the ATO rate cannot retroactively move a deduction already claimed.
  The form warns, without blocking the save, when the distance exceeds the ATO's
  cap on kilometres claimable per car per year under this method. The
  `deduction_basis_attribution` check constraint holds each basis to its own
  column (`distance_km` set only when `basis = 'distance'`); the database does
  not itself compute `amount_cents` from `distance_km`, since the cents-per-km
  rate is versioned in `@nest/tax`, not stored in Postgres. A deduction on the
  amount basis may be claimed at less than its full cost: `full_amount_cents`
  states what it cost, `work_use_percent` the share claimed (100 by default), and
  `amount_cents` — the figure every reader still uses — must equal
  `full_amount_cents` at that percentage, rounded to the nearest cent
  (`deduction_work_use_apportioned`, enforced in the database rather than trusted
  from the client, because a wrong figure here is a wrong figure on a tax return;
  `workUseAmountCents` computes the same rounding client-side so the form's shown
  claimable figure never disagrees with what the constraint will accept). The
  form's "Amount" field is the full cost, not the claim, so editing a part-claimed
  deduction reopens on what it cost rather than showing back a figure that was
  itself derived; a "Work use %" field beside it (`deduction_work_use_range`:
  greater than 0, at most 100) shows the claimable amount once it departs from
  100. A distance-basis claim is pinned at 100% work use
  (`deduction_work_use_basis`): its kilometres are work-related already, so a
  percentage on top would discount the claim twice. `full_amount_cents` has no
  plain column default — "whatever `amount_cents` says" depends on another
  column of the same row, which `DEFAULT` cannot express — so a
  `snapshot_deduction_full_amount` BEFORE INSERT trigger fills it from
  `amount_cents` when a write leaves it unstated, the same shape
  `snapshot_payslip_line_attracts_super` fills `attracts_super` with. Each deduction may
  carry stored receipts (`deduction_receipt`), the
  files held in a private Supabase Storage bucket (`receipts`) laid out under
  `<household_id>/<deduction_id>/…` so Storage RLS gates access by household
  membership. Adding a deduction lets the member pick receipt files as the
  FIRST step, before the deduction exists: the add form mints the deduction id
  client-side and each picked file uploads immediately to Storage under it
  (Storage has no foreign key, so this is safe ahead of the row — unlike
  `deduction_receipt.deduction_id`, a real, non-deferrable one). Picking the
  first file is what triggers extraction pre-fill: it is read with Claude Haiku
  4.5 via the `deduction-extract` edge function, which fills in the
  description, amount, and date that are not already the member's own — typed
  here already — with a note saying the details were extracted by AI and
  asking for them to be checked; every failure mode (an unconfigured key, a
  file that is not a receipt, an unsupported type or size, a rate limit, a
  model failure) reads as its own inline note and never blocks the save,
  exactly as payslip extraction. Only the first picked file is read — a second
  and further ones upload alongside it without a second read, since one
  confirmed read is what the form works from. Each picked file lists under a
  name field seeded with the file's own name, so a receipt is stored under
  whatever the member types — or "Receipt", where the field is cleared or the
  file carries no name of its own — the name being chosen on the way in rather
  than corrected afterwards. It is a label alone: `deduction_receipt.file_name`
  is what the UI shows, and naming never touches `storage_path` or the stored
  object. The deduction and every receipt already uploaded are written together
  in one transaction
  (`create_deduction_with_receipts`), keyed on the id the form minted, so a
  retried save rewrites the same deduction and replaces its receipt set rather
  than duplicating either. A picked file the member removes, or the whole add
  flow they walk away from, is deleted again, best effort: a delete that fails
  is swallowed, and a closed tab runs no cleanup at all. Editing an existing
  deduction carries none of this — its receipts are added, renamed, and removed
  individually from its row in the deductions list, each such upload creating
  its `deduction_receipt` row immediately since the deduction already exists and
  landing under its file's own name, which the row's own rename control edits.
  A **group** names a set of one member's deductions for the financial year —
  a subscription paid monthly, a trip's several receipts, anything claimed in
  more than one payment — and each payment is already a deduction in its own
  right, so grouping them is a READING of rows that exist rather than a new kind
  of row. A `deduction_group` names the group and `deduction.group_id` files a
  payment under it; the tab collapses the set to one row carrying the name, the
  payment count, and the summed total, expandable to the payments themselves,
  each with its own date, amount, and receipts. The total is summed from the
  payments and never stored, because every payment is a deduction the tax
  estimate already counts: a stored group total would be the only figure in the
  app able to disagree with what is actually claimed. Nothing downstream
  changes — the tax estimate, the EOFY tab, and the Summary read `deduction`
  rows and are indifferent to whether one sits in a group. Adding a payment from
  the group's own row is the ordinary add-deduction flow with the group filled
  in, extraction and all, so the amount and date come off the receipt for the
  member to confirm. A group is scoped to one financial year, as a deduction is:
  an expense whose payments span 30 June is one group per year, because a
  group's total is meant to BE the figure claimed for its year, and a group
  spanning years would total money from two returns while the tab could only
  ever show part of it. The composite reference (id, household_id, member_id,
  financial_year) holds a payment to its group's member and year, and dropping
  a group ungroups its payments rather than deleting them — each is still
  claimable on its own. Which group a deduction sits in is editable after the
  fact: the form offers a Group picker listing that member's groups for the
  year, with an explicit None, so a standalone deduction can be filed under one
  and a payment can be moved or taken back out. The picker is offered wherever
  the group is a question — editing any deduction, or adding a standalone one —
  and withheld where it is already answered, namely adding a payment from a
  group's own row, which is what that control means. Editing is a plain field
  update rather than `create_deduction_with_receipts`, so the group it writes
  cannot be dropped the way the add path's was.
- Payslips: each member owns many payslips (the `payslip` table, FY-scoped), one
  per pay event, carrying the actuals — gross, tax withheld, super, net, plus the
  slip's optional salary sacrifice and year-to-date running totals. A slip is filed
  under the financial year its pay LANDED in — derived from `paid_on`, falling back
  to the pay period's last day where the slip states none — because the ATO assesses
  salary and wages in the year they are paid, so a fortnight worked to 28 June and
  paid 1 July counts in the later year. The form derives that year and shows back
  which date decided it, and the `payslip_financial_year` check constraint holds the
  same rule in the database, `financial_year` staying a plain writable column rather
  than a generated one. The pay period is never clipped to that year: a straddling
  period counts all of its own days, and where the pay cycle is known the year's own
  length does not enter the arithmetic at all — it supplies the 365/366 denominator
  only for a slip with no cycle to read. Every OTHER expectation is a fraction of one
  PAY PERIOD, not of the year: a fortnightly wage is paid 26 times a year, not the
  26.07 a calendar-day share of the year implies, so a part period is the per-period
  amount times its days over the days one whole turn of the cycle spans (7 × weeks
  for a week-based cadence, the real calendar length of the months a turn runs
  through from the period's first day for a month-based one). The cycle read is the
  inflow's PAY cadence — `pay_schedule` where the row states one, `schedule`
  otherwise — never the frequency its amount is merely expressed in. A whole period
  therefore yields the per-period amount exactly on either basis, so there is no jump
  at the boundary and no proration remainder to excuse. A figure lands on that part
  basis two materially different ways and the card SAYS WHICH: either the period is
  not one whole turn of the cycle (a first or last slip, an off-cycle or back-pay
  one), so its figures really are a fraction of a period's pay; or the period IS a
  whole turn and it is the dated inflow behind it that covers only part of it — a pay
  rise modelled as the old rate ending and a new one starting — where each share is
  exact, the shares sum to a whole period at the blended rate, and a variance against
  one is real pay off plan rather than proration noise. A slip's
  own YTD figures rank by payment date too, so the anchor slip is whichever pay
  landed last, while the LIST stays ordered by pay period — every slip has one,
  `paid_on` is optional. The figures are
  always confirmed by the member, and one employer per member means there is no
  per-employer stream handling — a job change is modelled the way a pay rise is,
  the old inflow ending and a new dated one starting. A slip carries NO inflow of
  its own: its LINES (`payslip_line`) are the whole of its reconciliation, each an
  amount under the label the slip prints, and each stating its `kind`. An
  `earning` names the projected inflow it draws on (nullable — a bonus or back-pay
  line maps to none); a `tax` line names the component of the liability it pays
  (`payg` or `stsl`) and no inflow, a check constraint holding each kind to its own
  columns. One payment routinely covers several projections at once — salary plus
  one or two on-call allowances — and many lines may draw on the SAME inflow
  (ordinary hours and annual leave both come off the salary), so gross variance is
  measured per inflow: each inflow's lines are summed and held against that
  inflow's expectation for the period, keeping a steady salary's variance at nil
  while a lumpy allowance's stands on its own. A group drawing on an inflow that
  arrives in only SOME pay periods is not measured against the period at all: it
  reports a null expectation and variance on an `occasional` basis and the card says
  "Not measured per period" rather than "No projection to compare", the projection
  existing and being annual. The slip's whole gross expectation goes null too, with
  the amount named, because summing only the measurable groups would hold the WHOLE
  gross against part of it and read an ordinary on-call fortnight as above plan by
  the whole allowance; an unmapped line still reads as gross above plan, its earnings
  genuinely being unexplained. Withholding STAYS the year's liability spread evenly —
  the liability is one figure over all of a member's income and marginal rates make
  it no sum of per-inflow parts — so a period carrying the allowance withholds more
  than that, which the card says. Such an inflow is read across the YEAR instead: one
  row per inflow no period measures above the member's list, its actual so far against
  what the plan expects by the date the latest pay reaches, shown once rather than
  on every card where it would read as the per-period comparison it is not. A ONE-OFF
  joins that block on the same rule and for a plainer reason — it states a date rather
  than a cadence, so no period was ever owed a share of it and it is never the slip's
  cadence anchor however large its group — but its row is worked out differently: an
  occasional inflow's expectation is prorated across the days of the year run through,
  because its money accrues over them, while a one-off's is a STEP, the whole amount
  from the day it lands and nothing before, so a redundancy due in May is not most of a
  year's worth behind in December nor a cent short the day after it is paid.
  A slip's tax is measured per component the same way — STSL against the
  compulsory HELP repayment inside the liability, PAYG against the rest — so a
  study-loan component that is short cannot hide behind income tax that is over.
  The pay cycle the slip's OWN expectations
  (withholding, concessional super) are divided by is derived from the largest
  MEASURABLE earnings group's inflow; where the lines name no such projection there
  is no cycle and every figure is apportioned by calendar days of the year, which a
  disagreement among the groups is deliberately NOT — the cadence check still requires
  the period to be one whole turn of the chosen cycle, so a wrong pick costs the
  scaling and never a wrong division. An occasional inflow is never that anchor
  however large its group: its cadence says which turns the money could land on, not
  how many times a year it does, and it rides the steady inflow's payrun, which is the
  cycle the employer really withholds on. The lines need not sum to the printed
  gross or tax total; each remainder is unallocated and surfaced, not absorbed,
  which keeps the printed totals an independent cross-check against a misread.
  Expected employer
  super is charged on the gross less every earnings line recorded as earning
  none, so an on-call allowance never inflates it; each line snapshots that
  decision from its inflow when it is written, because a payslip is a historical
  record and retiring the inflow must not move what a past slip was measured
  against. A slip with no lines has nothing to be measured against, so it expects
  no gross and charges the guarantee on all of it. The slip and its lines are
  written by one RPC
  (`upsert_payslip_with_lines`) keyed on the id the form mints, so a save is one
  transaction and a retry rewrites the same slip rather than duplicating it.
  Itemisation is per-period totals only — there is no shift or roster entity. Each slip may carry
  an attached document, the file held in a
  private Supabase Storage bucket (`payslips`) laid out under
  `<household_id>/<payslip_id>/…` so Storage RLS gates access by household
  membership. Picking that document is what triggers **extraction pre-fill**: the
  form mints the payslip id, stores the file under it straight away (the file is
  the auditable record either way, and the `payslip-extract` edge function takes an
  object path), then reads it with Claude Haiku 4.5 and fills in the figures it
  found. Each one lands in the field it fills, and one short note says the details
  were extracted by AI and asks for them to be checked against the document — the
  member checks the fields, so the note restates none of them. It reads the slip's ITEMISATION the same way: each
  printed earnings line and each printed tax line, label and amount as printed, a
  section TOTAL row never among them because each total is a scalar figure already.
  Those tables print a column per period beside a year-to-date column, so a row's two
  amounts are reported SEPARATELY and only the period one becomes a line: a row
  printed year to date alone is money earlier pays carried and is left out quietly of
  earnings and tax alike, since itemised into this pay it would inflate the per-inflow
  gross variance, the unallocated remainder, the OTE base for expected super, and the
  per-component tax variance. The two columns are never compared — on the first pay of
  a financial year they legitimately match — and a period amount that is printed but
  unconvertible stays the gap it is rather than being dropped.
  A tax line's component comes from the model, the slip stating it plainly, and a
  line whose words do not say comes back unnamed rather than quietly `payg` — that
  line fills in with its component unset, its own picker asks which part it pays,
  and the save waits until the member says. Which INFLOW an earnings line draws on
  is never asked of the model, the
  household's inflows being nothing the slip shows: the client matches the printed
  label against the member's own taxable inflow names, whole label to whole name
  ignoring case and whitespace, pre-selects only on a single exact match shown on
  the line's own picker, and leaves every other line's inflow to be picked.
  Extraction writes nothing: it never overwrites a
  figure that is already the member's — one they typed here, or one the payslip
  being edited already holds — nor lines that are, a section at a time: the earnings
  lines and the tax lines are each the member's own once any row of that section was
  edited here or came off the saved slip, so a read itemises only the sections left
  alone and stands its lines in for the untouched rows there. Every field and every
  line stays editable, and the member's
  own save is what persists. A negative LINE amount pre-fills as printed, where a
  negative total is left blank for the member to type — `payslip_line.amount_cents`
  is signed and the slip's own totals are not — and a line whose printed amount
  cannot be converted is left out rather than filled in half-way, the gross it does
  not account for reported as unitemised against the lines themselves.
  An unconfigured key, a file that is not a payslip, an
  unsupported type or size, a rate limit, and a model failure each read as their own
  inline note and fall back to manual entry; none blocks the save. A stored document
  the member clears, replaces, or walks away from is deleted again, best effort: a
  delete that fails is swallowed rather than surfaced, and a closed tab, a refresh,
  or a killed PWA runs no cleanup at all, so an object no payslip references can
  survive. Payslips drive per-period
  variance against the projection (gross, withholding, super) and the FY's summed
  actual withheld feeds the tax engine's `paygWithheldCents`, turning the estimate's
  balance into a concrete refund or bill. The tab's three year-to-date figures —
  gross, withheld, super — each carry the SAME reading for the year, in a card's own
  wording and colours: the expected side is the sum of the expectations already
  measured for the slips entered, never an annual figure times the share of the year
  elapsed, so a fortnight not yet entered is not reported as $5,000 behind and the
  year is literally the cards' own `PayslipVariance` objects summed. A slip a figure
  has no expectation for is dropped from BOTH sides rather than counted against nil
  — which would read an unmapped $9,000 bonus as $9,000 above plan — so each figure
  is counted over the slips it can cover and says "across 3 of 4 slips" where that
  is fewer than the whole year, or "No projection to compare" where it covers none.
  The three are counted separately because a slip may have one figure's expectation
  and not another's. The withheld figure — per period and
  year to date — is the slip's whole PRINTED tax total, PAYG income tax plus any
  STSL study-loan component, because the liability it nets against already includes
  the compulsory HELP repayment that STSL pays; the extraction prompt, the entry
  form, the column comments, and `docs/payslips.md` all say so. Itemising the two
  as tax lines splits how the variance READS, never what the year counts as
  withheld: that stays the sum of every slip's printed total. RLS is household-wide,
  exactly as for the other per-member tax tables: `member_id` is a tax attribution,
  not a privacy boundary.
- Superannuation: modelled in full per person. Concessional contributions reduce
  taxable income and are taxed at 15% in the fund, with Division 293 for high
  earners; contribution caps (with manual carry-forward) and the government
  co-contribution are modelled, all from the versioned per-FY config alongside the
  tax config. Each member's balance is a dated baseline that auto-accrues modelled
  contributions between manual true-ups, seeds a net-worth view (assets less
  liabilities: account balances split into super and other, plus the vested value
  of each member's startup-equity grants, less each member's HELP debt; any
  account can be excluded via a shared household-wide flag that drops it from
  net-worth totals alone — not retirement projection or budgeting), and projects
  to retirement under client-side (localStorage) return/age assumptions.
- Equity: each member owns many startup-equity grants (options or shares) on their
  own Equity tab (the `equity_grant` table), with a cliff and vesting schedule.
  Entry is manual — there is no Cake or cap-table API — so the household maintains
  the current price per share itself. Only the vested portion is valued (options
  at their gain over the strike, shares at the price per share) and that vested
  value counts toward net worth as an asset. The vesting and valuation math is
  pure, in `@nest/plan`.
- Budgeting is plan-only and fortnightly: the household allocates projected
  after-tax income across grouped categories (Needs / Wants / Discretionary /
  Temporary / Savings / Investments) with a live remaining buffer; actual-spend
  reconciliation via Up ingestion is a later enhancement. Each line carries an
  amount on a frequency (weekly through annual, or an arbitrary every-N-weeks or
  every-N-months cadence, exactly as inflows do), normalised to fortnightly and
  annual. A budget
  line's amount can be **derived** rather than typed. A **breakdown** — a
  user-created, name + group itemised list (amount + frequency) — owns one derived
  line via `budget_line.breakdown_id`, which is how medications and any other
  itemised budget are modelled; the `breakdown` table holds only these generic
  (`breakdown_kind = 'generic'`) breakdowns, created and edited in the Breakdowns
  tab. Gift budget lines are a separate standalone roll-up keyed by
  `budget_line.is_gift_line`, derived directly from the gift tables by the reconcile
  pass with no breakdown row (`breakdown_id` null); gifts are managed solely in the
  Gifts tab (`/gifts`) and never appear in Breakdowns.
  Gifts fund each recipient separately: the reconcile derives one budget line per
  household member who has gift budgets (named "Gifts for &lt;member&gt;", keyed by
  `budget_line.gift_recipient_member_id`) plus one line for all external recipients;
  the gift planner stays a single unified screen. Each gift line's budget group is
  independent — set per line and preserved across reconcile (the breakdown's group
  only seeds a brand-new gift line), so "Gifts (others)" can be Discretionary while
  "Gifts for &lt;member&gt;" lines are Wants — whereas a generic breakdown's single
  line takes its group from the breakdown. A "Gifts for &lt;member&gt;" line
  is funded automatically from the **buyer's** — the other partner's — spending
  account (the other member's `type='transaction'` account, never the joint one),
  set by the reconcile each pass and NOT user-configurable (its "Funded from" picker
  is a read-only note; null when Up is unsynced), and its line is removed as soon as
  its budgets are gone. The external ("others") line and every generic derived line
  keep a user-set, editable funding account and route to their own pay split. A gift's agreed budget is shared and keeps feeding those
  derived lines and pay splits, but its purchases and the spent/remaining they
  derive are private from
  the recipient: a `gift_recipient` links to a household member via `member_id`,
  and when it does, RLS on `gift_purchase`
  (`hidden_gift_budget_ids_for_current_member`) hides that member's own-gift
  purchases from them and blocks them logging one, while the Gifts screen shows
  them only the budgeted amount. The recipient may still edit that shared agreed
  amount (RLS on `gift_budget` permits it and the Gifts screen offers the edit
  control), since the budget is jointly planned; only the spend stays hidden — the
  buyer (any other member) sees everything.
  A purchase is either hand-entered or linked from a synced Up card transaction:
  the Gifts tab's "From your card" inbox offers each unclaimed `gifts-and-charity`
  transaction (see Ingestion) to link against a gift budget — picked as a recipient
  and then one of that recipient's occasions, two dependent selects that name the
  one budget for the pair; the
  purchase takes the transaction's amount and its local posting date, with only the
  description editable — or to set aside as "not a gift"
  (`gift_transaction_dismissal`), Up's category covering charity too. The inbox
  respects the spend privacy above from both directions: the pickers omit
  gifts for the signed-in member (and the recipient itself where their every gift is
  one), whose purchases RLS refuses anyway, and the
  `transactions` policies withhold both a transaction outside the member's
  balance-visible accounts (`visible_balance_account_ids()`, so a gift bought on
  the buyer's own spending account is invisible to the recipient) and one already
  claimed as a gift for them (`hidden_gift_transaction_ids_for_current_member()`,
  so a joint-account gift is a candidate for both partners until one claims it and
  is withheld from the recipient thereafter). No account choice is needed to keep
  a surprise intact.
  Both household members are permanent recipients: each member's recipient is
  auto-created with the member (an insert trigger), removed with them (an
  `on delete cascade` FK), limited to one per member (a partial unique index),
  and non-editable (an update guard), so adding a recipient is for external
  people only.
  The household also plans a single household-wide **ad hoc gifts** buffer
  (`gift_discretionary_budget`, one row per household, created lazily on first
  edit) for gift spend nobody itemised against a recipient or an occasion in
  advance; its planned amount folds into the existing external ("Gifts
  (others)") derived line rather than minting a line of its own. A
  `gift_purchase` counts against exactly one of a `gift_budget` or the
  household's discretionary buffer, never both and never neither
  (`gift_budget_id` and `gift_discretionary_budget_id` are each nullable, and
  exactly one is set). An ad hoc purchase may optionally tag a `gift_recipient`
  (`recipient_id`) for record-keeping only: the tag carries no budget of its
  own, so it is set only alongside `gift_discretionary_budget_id`, never on a
  budget-linked purchase, whose recipient is already `gift_budget.recipient_id`.
  The same purchase privacy applies to the tag as to a budget-linked purchase's
  recipient: RLS on `gift_purchase` branches on which kind of purchase a row is
  — a budget-linked purchase keeps the existing
  `hidden_gift_budget_ids_for_current_member()` check, while an ad hoc purchase
  is hidden only when its `recipient_id` links, via
  `hidden_gift_recipient_ids_for_current_member()` (mirroring the budget
  helper), to the current member — so a purchase tagged to a member's own
  linked recipient is hidden from that member and cannot be logged by them,
  exactly as a budget-linked purchase for their own gift is, while an untagged
  purchase, or one tagged to the other member or an external recipient, is
  visible to both. The Gifts screen's "Ad hoc gifts" card is always visible,
  outside the occasion/person grouping, with its own editable budgeted amount
  and purchase list, each purchase's optional recipient picker sourced from the
  household's existing recipients (members and external) rather than free text.
  A line can also be **routed** to the account that funds it via
  `budget_line.destination_account_id` (Savings/Investments route through their
  goal's linked saver instead); the Pay splits tab sums each account's routed lines
  into a recommended fortnightly Up pay split. The household designates the single
  spending account its pay lands in (`households.pay_account_id`, set via the
  `set_household_pay_account` RPC); pay stays there and every other routed account
  — the other spending accounts and the savers — becomes a recommended split. Up
  exposes no pay-split API, so the household types the split into Up by hand and
  **confirms** the amount it set into the `pay_split` table; the Pay splits tab flags
  when the recommendation later drifts from the confirmed amount and offers a
  Confirm to re-record it.
- Wishlist: the household keeps a list of aspirational purchases on its own
  Wishlist tab (`/wishlist`, the `wishlist_item` table) — a name, a positive
  `amount_cents` rough cost, an optional `member_id` tag naming whose wish it is,
  and an optional `note`. The `member_id` tag is a DISPLAY and reporting label
  only — money stays pooled, there are no per-person budgets, and it feeds
  nothing downstream (`on delete set null` if the member goes). A wishlist item
  carries no cadence, funds nothing, and is absent from the fortnightly buffer,
  the tax estimate, and pay splits. Two per-item promote actions open a target
  tab's add form prefilled and leave the wishlist row in place (no "promoted"
  state): "Make a savings goal" seeds a `savings_goal` with the item's name and
  `target_amount_cents` and no date; "Add to budget" seeds a `budget_line` with
  the name and amount, group defaulting to Discretionary and the frequency left
  for the household (a wishlist amount is a lump sum). Household-wide RLS, exactly
  as `savings_goal` / `budget_line` / `temporary_item`.
- Ingestion: both partners bank with Up. The account-balance slice is built and
  deployed — members connect an Up personal-access token (held in Vault), and
  `up-sync` polls every Up account (savers and spending alike) into `accounts`
  and `account_balance` via the `upsert_up_accounts` RPC (identity and balance in
  one transaction), so a goal linked to a saver tracks its real balance and every account the
  member can see — plus any member's spending account by name via
  `account_directory` — is available as a budget-line funding destination (a
  co-member's savers stay private). Deduped on (source,
  external_id): a joint account shared across both partners collapses to one
  shared row (`owner_member_id` null), while individual accounts are attributed
  to their owner; an individual spending account's name is stored prefixed with
  the owner's name in possessive form (e.g. "Alex's Spending") to disambiguate
  the household's two spending accounts. Transaction ingestion covers one Up
  category: the same poll lands each member's `gifts-and-charity` transactions in
  `transactions` (Up's category in `external_category`, the household's own
  `category_id` null) via the `sync_up_gift_transactions` RPC, so a gift purchase
  can be linked to real card spend (`gift_purchase.transaction_id`) or set aside
  as not a gift (`gift_transaction_dismissal`). It rescans a fixed 365-day
  trailing window each run rather than following a cursor, because Up raises no
  event when a transaction is recategorised — which is how most gift spend gets
  categorised — and prunes the candidates Up no longer reports in the category,
  keeping any a purchase links to. The ledger's per-account privacy applies: a
  co-member's gift candidates on their own spending account stay invisible, and
  joint-account spend is a candidate for both partners until it is claimed as one
  partner's gift, at which point it is withheld from them. A general ledger
  (every category, spend reconciliation, actual tax paid) is deferred.
  Sources (Up Bank API + manual entry) are
  source-agnostic. Edge functions (`up-connect` / `up-disconnect` / `up-sync` /
  `up-webhook` / `changelog`) live under `supabase/functions/` and auto-deploy to
  prod on merge via `.github/workflows/deploy-functions.yml`, whose deploy step
  retries a bundle that fails because Docker could not start a container. Prod
  running every function in the directory is asserted, not assumed:
  `.github/workflows/check-function-drift.yml` compares the two every six hours,
  and the deploy workflow re-runs the same check straight after its push (see
  [`docs/operations.md`](docs/operations.md#deployment)).
- Changelog: an in-app "What's new" tab reads recent user-facing changes from
  GitHub via the `changelog` edge function (a server-held `GITHUB_CHANGELOG_TOKEN`
  fine-grained PAT), showing open PR titles as in-progress and merged-commit
  subjects as implemented, keeping only `feat`/`fix`/`perf` entries. The build's
  commit SHA is stamped into the app (`VITE_COMMIT_SHA` from
  `VERCEL_GIT_COMMIT_SHA`) and sent to the function, which splits the raw commit
  list at that commit: that commit and older are implemented (so a stale/cached
  PWA never shows entries newer than the build it is running), and the commits
  newer than it are returned as an "Update available" list with a Reload-to-update
  button that force-updates the PWA to the latest deployed version.
- Push notifications: alerts reach the installed PWA over Web Push (RFC 8291
  payload encryption, RFC 8292 VAPID auth) — no push vendor and no native app. A
  member opts in **per device**: the subscription (endpoint plus its two keys)
  lands in `push_subscription`, upserted on the globally unique `endpoint` so a
  re-subscribe refreshes the row. That table is the one exception to the
  shared-household rule — an endpoint is a bearer capability to make someone's
  phone buzz, so RLS scopes all four commands to the owning member
  (`current_member_ids()`), a co-member can neither read nor delete nor reassign
  it, and `service_role` holds only `select` (to send) and `delete` (to prune).
  The VAPID keypair and its `mailto:` subject live in Vault, read only through the
  service-role-only `vapid_keys()` RPC and set by hand; `push-key` serves the
  public key so rotating the pair needs no rebuild, and `push-test` sends a
  verification notification to the caller's own devices, pruning a row only on a
  `404`/`410` and reporting `{ devices, sent, pruned, failed }`. The payload is
  `{ title, body, url }`, the URL being where `notificationclick` navigates.
  Deciding **when** to notify is out of scope: there is no scheduled evaluation
  pass and no buffer / goal / expiry trigger, so a push happens only when a member
  asks for a test.
- EOFY sharing: a household gives a tax agent read-only access to its EOFY
  summary (estimate, withholding position, deductions with receipts, super,
  HELP debt, payslip documents) via a scoped, time-limited bearer link — never
  by inviting them as a member and never a raw export. `share_grant` holds at
  most one live share per household (`household_id` is its primary key), a
  7-day expiry, and `token_hash` — never the plaintext token, which
  `create_share_grant` returns once and nothing stores — minted/replaced and
  revoked only through SECURITY DEFINER RPCs; `authenticated` gets a
  column-level grant that withholds `token_hash` even from the household
  itself. Three edge functions do the work: `share-create` (JWT-verified)
  mints the grant as the caller and emails the link via Resend when
  `resend_api_key` is set (minting either way, so an email failure never
  costs the household its link); `eofy-share` and `eofy-share-file`
  (`verify_jwt = false`, matching `up-webhook`) resolve the bearer token
  against `share_grant` with a service-role client — an anonymous holder has
  no `auth.uid()` for any table's own RLS to match — and serve the same rows
  the EOFY tab loads, and a 5-minute signed Storage URL per receipt/payslip
  document scoped by its own database check (the file access boundary here,
  not Storage RLS). The shared view is `EofyScreen.tsx` itself, fed by
  `EofyShareSection.tsx` at `/share/eofy/:token` (matched ahead of the
  session gate in `App.tsx`, so a tax agent never touches
  `supabase.auth.getSession()`) composing `eofy-share`'s rows through the
  same `estimateHouseholdTaxFromRows`/`superCapSummaryFromRows`/
  `helpPayoffByMember` pure functions `EofySection.tsx` uses, so the two
  views agree by construction rather than by a second implementation kept in
  sync — including `members[].date_of_birth`, which prices a one-off
  termination payment's tax-free amount and would otherwise silently
  mis-tax a redundancy near preservation age on the shared view alone.
  `EofyShareControl.tsx` on the EOFY tab shows the freshly minted link once
  — the household's own app never stores it either, so it cannot be
  recovered on a later visit — alongside Revoke. See
  [`docs/eofy-sharing.md`](docs/eofy-sharing.md).

## Conventions

- All planning happens in Linear, under the Nest project
  (`willsawyerrrr-dev` / WSD team). Do not produce ad-hoc chat plans or
  planning documents outside Linear — capture scope, decisions, and
  breakdown as Linear issues/documents on the Nest project instead.
- Every piece of implementation work traces to a Linear issue. Before
  starting, there is an issue for it (create one if not); the branch name
  carries the issue key (`willsawyerrrr/wsd-<n>-<slug>`, Linear's own
  format) so the PR links automatically, and the PR body names the issue.
- The work drives the issue's lifecycle: move it to **In Progress** when a
  branch is cut, **In Review** when the PR opens (attach the PR to the
  issue), and let the merge move it to **Done**. Never leave a merged PR's
  issue sitting in Backlog/Todo, or an unmerged issue marked Done.
- Anything found along the way that is not part of the current issue —
  a deferred slice, a follow-up, a bug, a polish pass on already-merged
  work — gets its own new Linear issue (related to the originating one),
  not just a note in a PR description. One issue per shippable change.
- Money is stored as integer minor units (cents); never floats.
- Integer-cent numeric literals are grouped to read as dollars: a trailing `_NN`
  for the cents, then `_NNN` groups for the dollars (e.g. `18_200_00` = $18,200.00).
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- The in-app "What's new" changelog is sourced from merged-commit subjects on
  `main` (squash-merge uses the PR title) and from open PR titles, and surfaces
  only `feat`, `fix`, and `perf` entries — hiding `chore`, `docs`, `ci`, `test`,
  and `refactor`.
- Because the changelog shows only the description (the type becomes an emoji and
  the scope is hidden), write each PR title's description so it reads as a clear,
  self-contained sentence that makes sense without the scope — e.g. prefer
  `feat(splits): Sort pay-split rows by title or amount` over
  `feat(splits): Add sorting`, whose description ("Add sorting") is meaningless
  once the `splits` scope is dropped.
- CI must complete in under 1 minute. If a run exceeds that, diagnosing and
  reducing CI time takes priority over other work. CI runs as separate parallel
  jobs (`check`, `test`, `rls`, `functions`) aggregated by a `ci-status` job that
  is the single required `CI Status` check, so overall wall-clock is the slowest
  single job, not the sum; the job/coverage/shard specifics are canonical in
  [`docs/architecture.md`](docs/architecture.md#ci). Steps WITHIN a job stay
  sequential: on a single 2-vCPU runner, running CPU-bound steps concurrently only
  causes contention and inflates each one without improving wall-clock time.
  Splitting into separate jobs avoids that by giving each its own runner.
