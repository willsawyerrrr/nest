# Payslips — expected vs actual income and tax

The plan-only app **projects** income (from inflows) and **estimates** tax (the
`@nest/tax` engine over each member's taxable inflows and `tax_profile`). Both are
forward models: they say what a member *should* earn and *should* be withheld.
A **payslip** carries the actuals — gross, total tax withheld, super, deductions,
net, for one pay period, plus year-to-date running totals. Capturing payslips lets
the household reconcile actuals against the projection, per member, per pay period,
and surface variance: actual gross vs projected inflow, actual tax withheld vs the
estimate's implied withholding, actual super vs the modelled contribution.

The withheld figure is the slip's **tax total** — PAYG income tax plus any STSL
study-loan component — never the PAYG line alone. See
[Tax withheld is the slip's tax total](#tax-withheld-is-the-slips-tax-total).

Amounts are integer minor units (cents), as everywhere. Reconciliation is
per-member because AU tax is assessed per person and each member's income is
tagged to them.

## Goal

- Record, per member and per pay period, the actual figures from a payslip and
  correlate them with what the plan expected for that period.
- Surface variance the household can act on:
  - **Gross**: actual per-period gross vs the projected inflow for that member,
    prorated to the pay period. A persistent gap flags a stale inflow (a raise, a
    changed roster, a bonus). One payment routinely covers several projections at
    once — salary plus one or two on-call allowances — so the gross is measured
    **per inflow** where the slip is itemised into earnings lines.
  - **Tax withheld**: actual withheld — the slip's whole tax total — vs the
    estimate's implied per-period withholding. The tax estimate is
    annual-liability ÷ periods, and that liability includes the compulsory HELP
    repayment the slip's STSL component pays, so the two sides only line up when
    the withheld figure is the total. Comparing them is the leading indicator of a
    refund or a bill at year end.
  - **Super**: actual employer SG (and any salary sacrifice shown on the slip) vs
    the modelled super guarantee and concessional contributions, which feed the
    super balance accrual and the concessional-cap tracker.
- Feed **actual** tax withheld into the year-end position. The tax engine accepts
  `paygWithheldCents` and returns `balanceCents` (positive = owing, negative =
  refund); summed actual withholding from payslips is the real input to that field,
  turning the estimate's abstract liability into a concrete refund/bill projection
  — the same outcome the Up ledger phase targets from the spend side.

## AU payslip fields

An Australian payslip is legally required to show, per pay period, the employer and
employee, the pay period dates and payment date, gross pay, net pay, and any
deductions and their purpose; and to show the super guarantee amount and the fund.
In practice a slip carries:

- **Pay period**: start and end dates (and often the payment date).
- **Gross** for the period, and **YTD gross**.
- **Tax withheld** for the period, and **YTD withheld** — a total that may itemise
  PAYG income tax and an STSL study-loan component beneath it.
- **Superannuation guarantee** for the period (employer SG), and often **YTD
  super**; **salary sacrifice** super shown separately when arranged.
- **Deductions** (pre- and post-tax) and **allowances**, itemised.
- **Net pay** for the period.
- **Leave balances** (not financially relevant here).

The must-have quartet for reconciliation is **gross, tax withheld, super, net**
for the pay period; YTD figures are valuable as a cross-check (they let a single
recent payslip anchor the whole year without entering every prior slip).

### Tax withheld is the slip's tax total

A slip withholds two amounts under one TAX section: **PAYG** income tax, and an
**STSL** (study and training support loan) component — the withholding that pays
down HELP/HECS. A real fortnight prints:

| Line | Amount |
| --- | --- |
| PAYG | $1,416.00 |
| STSL | $434.00 |
| **TAX** | **$1,850.00** |

and net pay reconciles against the total: $5,495.50 gross − $1,850.00 =
$3,645.50.

`payslip.tax_withheld_cents` holds that **total**, and `ytd_tax_withheld_cents`
the year-to-date total on the same basis. That is what the tax engine needs. Its
`totalLiabilityCents` is income tax less offsets, plus the Medicare levy and
surcharge, **plus the compulsory HELP repayment**, plus Division 293; the balance
it reports is that liability less `paygWithheldCents`. Because the liability side
already carries the HELP repayment, the withheld side must carry the STSL that
pays it — record the PAYG line alone and the estimated bill is overstated by every
dollar of STSL withheld ($434 a fortnight, over $11,000 a year on this slip). The
same holds for the per-period variance, which measures withholding against that
same annual liability.

So the total is what every surface asks for: the extraction prompt tells the model
to report the printed tax total rather than the PAYG line (and to read the printed
total, never sum the components — it is barred from deriving figures by
arithmetic), the entry form says so beneath the quartet, and both column comments
say so in the schema. Where a slip prints one tax figure and no total — a member
with no study loan — that figure *is* the total, and nothing changes.

### Privacy

Payslips are sensitive personal documents (name, employer, income, sometimes tax
file references). Files go in the **private `payslips` Storage bucket**, never
public, with access mediated by Storage RLS keyed on household membership — the
same isolation boundary as every table. The structured figures live in a
household-scoped table under the same RLS. No file is required for the feature to
work: the numbers alone drive every variance.

## Capture options

**(a) Manual entry form.** A member types the key fields (pay period, gross, tax
withheld, super, net) into a form; nothing is uploaded. Simplest to build, no
Storage, no parsing, works offline in the PWA. The figures are exactly what
reconciliation needs. Downside: manual transcription each pay period.

**(b) File upload + manual key-field entry.** As (a), plus the member attaches the
PDF/image to a private Storage bucket for the record. The structured figures are
still typed; the file is an auditable attachment, not a data source. Adds Storage
RLS and an upload flow, but no parsing risk. Good middle ground once the household
wants the source document retained.

**(c) Automatic extraction.** Upload the slip and read the fields off it
automatically. Payslip layouts vary wildly by employer and payroll provider, so
per-format parsing is hopeless and the pass is an LLM one; every extraction still
needs human confirmation before it counts. Built as
[stage 3](#stage-3-llm-extraction-payslip-extract) — the `payslip-extract` edge
function — which only ever pre-fills the same manual form.

The app does **(a) manual entry** with **(b) optional file attachment**: the
figures are always the member's own, and the slip may be kept alongside them.
**(c) extraction** is a convenience that only ever pre-fills that same form, never
writing figures unconfirmed — see *Staging*. Manual entry alone delivers the entire
correlation value; upload and extraction reduce effort but add no new analysis.
This mirrors how the app favours smallest-useful-first (inflows before ingestion,
manual goal balances before Up savers).

## Data model

Two household-scoped tables, mirroring the conventions of `tax_profile` and
`super_contribution` (cents in `bigint`, RLS on household membership, composite FKs
on `(id, household_id)`). The column list, constraints, and RLS boundary are
canonical in [`data-model.md`](data-model.md#tax-inputs); the shape in brief:

- **payslip** — one actual pay event for a member: the pay period and payment
  date, the gross / tax withheld / super / net quartet, the slip's optional
  salary sacrifice and YTD running totals, a `note`, and a `file_path` for the
  attached document.
- **payslip_line** — one earnings line on that slip, under the label the slip
  prints, with the projected inflow it draws on and whether it is ordinary time
  earnings. A slip owns many; itemising is optional. `amount_cents` is signed, so
  a negative adjustment records, and the lines need not sum to the slip's gross.
- A slip and its lines are written by one RPC,
  **`upsert_payslip_with_lines`** — one transaction, keyed on the id the form
  mints. Saving them as two calls would leave the pair half-written whenever the
  second failed: a slip with no lines on a create, and on an edit no lines at all
  once the clearing delete landed and the insert did not. Keying on the form's
  own id is what makes a retry idempotent — pressing Save again rewrites that
  slip instead of adding a second one to the year-to-date totals and the
  withholding the tax estimate nets against the liability.
- **`source_inflow_id`** on the slip is its **cadence anchor** — an explicit
  picker, chosen by the household, nullable because a slip need not name one (a
  bonus, back-pay, a one-off). `on delete set null` on the reference keeps the
  actuals when the inflow is retired. The same nullable reference on a line
  records which projection that earning draws on.
- **RLS is household-wide CRUD** on both, the same boundary as every other
  per-member tax table. `member_id` is a tax/reporting attribution, not a privacy
  boundary: the household's money is fully pooled, so each member manages their
  co-member's slips. A payslip is a sensitive document, and the household — not
  the individual member — is the trust boundary that protects it.

### Earnings lines and per-inflow variance

One employer pays salary and on-call in a single payment, and the two are
projected as separate inflows. A slip is therefore itemised the way it is
printed: **one `payslip_line` per earnings line**, each naming the inflow it
draws on. Four properties fall out of that shape.

- **Many lines may draw on one inflow.** Ordinary hours and annual leave are two
  lines of the same salary, so there is no uniqueness on
  `(payslip_id, source_inflow_id)`. They are summed into one group, and a
  fortnight that pays $4,000 ordinary plus $1,000 leave against a $130,000 salary
  reads as exactly on plan.
- **Variance is measured per group.** Each inflow's lines are summed and held
  against that inflow's expectation for the period, on the same
  cadence-or-calendar-days basis a whole slip uses. A lumpy allowance's variance
  is its own, not smeared across a steady salary's.
- **Nothing has to add up.** Gross the lines do not account for is
  **unallocated** and shown as such; it reads as gross above plan, which is what
  unexplained earnings are. Lines overshooting the gross read as a negative
  remainder.
- **A slip with no lines behaves as one figure.** Its whole gross is measured
  against its cadence anchor, in every respect: that one projection decides both
  what the gross should have been and whether it earned any super, so a slip
  anchored to an allowance expects no guarantee at all rather than the rate on
  the whole payment.
- **Half-itemising is a trap the form warns about.** Itemise the on-call
  allowance and leave the salary paid beside it untyped, and the expected gross
  collapses to the allowance's projection while the actual gross is the whole
  payment — a phantom variance the size of the salary. The form says so when the
  unitemised remainder is larger than everything itemised and at least one line
  names a projection: that is a missing line, not a rounding gap.

### Super is charged on ordinary time earnings only

The employer super guarantee accrues on **ordinary time earnings**, not on an
allowance paid on top of ordinary hours. An inflow records that in
`inflows.attracts_super`, and the expected employer super for a slip is the
guarantee rate on the slip's gross **less every line drawing on an inflow that
earns no super**.

The real case: a fortnight paying $5,000 salary and $495.50 on-call shows $600 of
employer super, which is 12% of the $5,000 — not of the $5,495.50 gross, which
would be $659.46. Charging the rate on the whole gross would read that slip as
$59.46 of super below plan every fortnight, for nothing. Formulating the base as
a subtraction is what keeps an itemised slip of ordinary earnings unchanged: with
nothing marked non-OTE there is nothing to subtract, so the base stays the gross.
The base never falls below nil, so a mistyped line overshooting the gross reads
as a typing mistake rather than negative super. The same exclusion applies to the
annual SG and percent-of-salary bases, so a non-OTE allowance never inflates the
modelled super balance either. It is **not** excluded from the co-contribution
income test, which is on total assessable income: an allowance is assessable in
full, and leaving it out over-states the entitlement.

The decision is **snapshotted on the line** at write time — `payslip_line`
carries its own `attracts_super`, taken from the inflow by a database trigger
when the line is written — rather than read back through the inflow when the slip
is displayed. `source_inflow_id` is `on delete set null`, so re-deriving it would
mean retiring an on-call inflow silently put every historical slip's allowance
back into the super base: a $5,000 base jumps to $5,495.50, the expected
guarantee from $600 to $659.46, and a year of correct slips starts reading "$59.46
below plan". A payslip is a historical record, and the OTE decision travels with
it exactly as every other actual on the slip does.

No new config: payslips are data, not versioned parameters. The **`payslips`**
Storage bucket is private, its objects keyed `<household_id>/<payslip_id>/<file>`
so a `storage.objects` policy gates them on the same membership check.

## Correlation / UI sketch

Payslips are actuals about income and tax, so they surface where those are already
shown — a **member-scoped payslips list** plus **variance callouts on the Tax
tab**:

- **Entry & list**: a per-member payslips list (candidate home: the Household tab
  next to tax profiles and Up connection, or a dedicated section) showing each
  period's gross / withheld / super / net and its variance against the projection,
  most recent first, with an "Add payslip" form. An itemised slip lists its
  earnings lines grouped by the inflow each draws on, with that group's total and
  variance, and names any gross the lines do not account for. The form takes the
  lines inline — a name, an amount, and the inflow it draws on per row — and
  reports the unallocated remainder as it is typed.
- **Variance computation** (pure, in `@nest/plan` or a sibling of `lib/tax`):
  - *Expected gross for the period* = each inflow the slip's lines draw on,
    annualised (via the existing `annualGrossCents` / schedule normalisation) then
    prorated to the payslip's period length, summed. Per group, that group's sum
    less its expectation is its variance; over the slip,
    `gross_cents − expected` is the gross variance. A slip with no lines is
    measured whole against its cadence anchor.
  - *Expected tax withheld for the period* = the member's annual estimated tax
    (from `estimateHouseholdTax`) ÷ periods per year, prorated to the period.
    `tax_withheld_cents − expected` is the withholding variance — the household's
    early read on whether the employer is over- or under-withholding versus the
    modelled liability.
  - *Expected super for the period* = modelled employer SG (`guarantee_rate ×`
    the period's gross less its non-OTE lines, or nil where an unitemised slip's
    cadence anchor earns no super) plus any period-prorated concessional
    contribution; `super_cents − expected` is the super variance.
- **Year-to-date refund/bill**: feed the summed actual `tax_withheld_cents` for the
  FY into the tax engine's `paygWithheldCents`, so the Tax tab's balance shows a
  concrete refund (negative) or amount owing (positive) from real withholding
  rather than the current nil assumption. YTD-withheld from the latest slip is an
  equivalent shortcut when per-slip entry is incomplete.

This sits naturally beside the Up ledger phase (which reconciles actual **tax
paid** from the spend/transfer side): payslips give the withholding actuals from
the income side, and the two converge on the same year-end position.

## Staging

Smallest-useful-first, each stage independently shippable. **All three stages are
built.**

1. **Manual entry + variance.** The `payslip` and `payslip_line` tables, the
   per-member entry form and list, the pure variance math (whole-slip and
   per-inflow), and the Tax-tab withholding/refund readout from summed actual
   withheld. Delivers the full correlation value.
2. **File attachment.** The private `payslips` Storage bucket,
   membership-scoped Storage RLS, `payslip.file_path`, and upload/download in the
   form and list. The record carries an auditable source document; the figures are
   still typed.
3. **Extraction pre-fill.** Read an uploaded slip with a model to pre-populate the
   form for confirmation, never writing figures unconfirmed. See
   [Stage 3](#stage-3-llm-extraction-payslip-extract).

## Stage 3: LLM extraction (`payslip-extract`)

The `payslip-extract` edge function reads the figures off a slip the member has
just uploaded, so the entry form opens pre-filled instead of blank. It is a
convenience over stages 1–2, not a replacement: everything it produces goes through
the same form and the same save.

### Extraction never writes a payslip figure

The function has **no write path for payslip data at all** — no table, no RPC, no
Storage write. It returns the fields it read; the client pre-fills the manual entry
form; the member confirms and saves; that save is what persists. A wrong tax figure
saved silently is worse than no extraction at all — nobody re-derives a number they
believe was read off the document — so confirmation is structural rather than a
convention the UI is trusted to follow. It also means a failure at any step can
leave nothing half-written.

### Request

The client uploads the file to the private `payslips` bucket **first** — the file
is the auditable record whether or not extraction succeeds — then posts the object
path:

```json
{ "path": "<household_id>/<payslip_id>/<uuid>-payslip.pdf" }
```

Storing precedes reading, so the upload runs when the file is **picked**. The form
mints the payslip id at that moment and files the object under it (a slip being
edited already has its id), which puts the object at its final key with nothing to
move on save — the row is then written under the id its document is already filed
against. An object stored for a row that is never written would be litter that no
payslip references, so it is deleted again as soon as the member clears the
picker, chooses another file, or leaves the form; a successful save is what makes
it permanent. A save while the store-and-read is still running is blocked for the
same reason: it would send no attachment, filing the object under an id no row is
written under.

That cleanup is **best effort**. A delete that fails is swallowed rather than
surfaced as a form error; closing the tab, refreshing, or killing the PWA runs
none of it (there is no `beforeunload` handler); and an upload still in flight
when the form goes is deleted only once it lands. Either way what survives is an
object in a private bucket that no payslip references — invisible and cheap,
which is the trade being made against failing a save over housekeeping.

JWT-verified (the default posture): the caller is resolved to their own member and
household from the Authorization JWT, never the body. The path is the client's, so
it is not trusted — its first segment must be the caller's own household, defence
in depth on top of Storage RLS. The object is then downloaded with the service
role and sent to the model. PDFs go as a document block, photos and scans as an
image block (JPEG, PNG, WebP); anything else is rejected before a request is built.

### Response

```json
{
  "model": "claude-haiku-4-5-20251001",
  "fields": {
    "period_start": "2026-07-06", "period_end": "2026-07-19", "paid_on": "2026-07-22",
    "gross_cents": 412050, "tax_withheld_cents": 104800, "super_cents": 47386,
    "net_cents": 307250, "salary_sacrifice_cents": null,
    "ytd_gross_cents": 1236150, "ytd_tax_withheld_cents": 314400, "ytd_super_cents": 142158
  },
  "text": { "gross": "4,120.50", "salary_sacrifice": null, "…": "…" },
  "missing": ["salary_sacrifice_cents"],
  "unreadable": []
}
```

- `fields` — the column-shaped values the form pre-fills from: ISO dates and
  integer cents, keyed as the `payslip` columns are, null where unavailable.
- `text` — the literal text read for each field, so the form can show what the
  model saw and the member can spot a misread rather than confirming one blind.
- `missing` — fields the slip does not show. **Every field is nullable**: a slip
  without super, or a figure the model cannot find, yields null. A partial
  extraction is a success; the member fills the gaps.
- `unreadable` — fields whose text came back but could not be converted safely
  (a misread `4,12O.50`, a date that is not a real calendar date). Null, with the
  text kept so the member can correct it.

### Pre-filling the form

`fields` is keyed as the `payslip` columns are, so the entry form maps it on by
name — ISO dates into the date pickers, integer cents into the dollar inputs.
Four rules govern what the form does with it:

- **A figure that is already the member's is never replaced.** Two kinds of value
  count as theirs, and the form pre-fills only what is left.
  - **One they typed in this form.** Edited-ness, not emptiness, is what the form
    tracks: it opens with a pay period already defaulted to the fortnight ending
    today, and a default is the form's guess (overwritable) while a typed value is
    the member's (not). A field typed *while a read is in flight* counts too — a
    read takes seconds, and the pre-fill is written field by field over live
    state rather than over the snapshot it started from.
  - **One the payslip being edited already holds.** Every non-blank figure on a
    saved slip was confirmed when it was saved, so attaching a replacement
    document reads the new slip without rewriting what was filed. Only the gaps —
    a blank amount, an unset date — are open to it. The text read for a kept
    field is still shown, so a figure the slip disagrees with can be corrected by
    hand.
- **A negative amount does not pre-fill.** Payroll systems print deductions as
  accounting negatives (`(1,234.56)`, `45.00-`) and the parser reads them, but
  every `payslip` amount column is checked `>= 0`. Rather than guess the sign, the
  client treats a negative exactly as an `unreadable` field: nothing is filled in,
  and the note shows the literal text printed so the member types the figure.
- **What was read is shown back.** A note under the picker names each field it
  filled beside the literal text it read for it (`Gross “4,120.50”`), the fields
  it kept because they were already the member's — with their text too, so a
  figure the slip disagrees with can be copied across by hand — the fields
  `missing` from the slip, and the fields it saw but could not convert
  (`unreadable`) and therefore left blank. Showing the text is the point: a
  misread is caught here rather than confirmed blind.
- **Nothing is confirmed by extraction.** Every figure stays editable and the
  submit is untouched, so the form saves whatever the member leaves in it. The
  reply is read rather than trusted, too: a body the form cannot render falls back
  to the same plain failure note as an unreachable function.

### Money is converted in TypeScript, never by the model

The model reports each amount as the **literal text printed on the slip**
(`"4,120.50"`, `"$1,234"`, `"(45.00)"`); a pure, exhaustively-tested converter
turns that into integer cents. Asking a model to multiply by 100 invites a silent
arithmetic slip in a tax figure, and per the repo's money convention the conversion
is integer arithmetic on the digit strings — never `parseFloat(text) * 100`, which
loses a cent on amounts as ordinary as `8.29`. Thousands separators, a leading
`$` / `A$` / `AUD`, absent cents, whitespace, and both negative conventions
(parenthesised and signed) parse; anything not unambiguously an amount yields null
rather than a wrong number.

### Model and cost

Claude Haiku 4.5, pinned to its dated snapshot `claude-haiku-4-5-20251001`
alongside the other edge-function dependencies — an unpinned model would silently
change which figures a slip yields. Structured field extraction from a document is
its use case, and it is the cheapest capable model: at $1 per million input tokens
and $5 per million output, a slip costs well under a cent, so a fortnightly slip
for each of two members is cents a year. Haiku 4.5 is on the standard vision tier
(images downscaled to a 1568px long edge), so a large photographed slip loses
detail in its small print; a PDF with a text layer is unaffected, since each page's
extracted text is provided alongside its image.

### Failure behaviour

Every failure is specific and none of them is a bug-shaped 500:

| Outcome | Response |
| --- | --- |
| API key unset | `503` `{ configured: false }` — the feature is off, not broken; the form still takes the figures by hand |
| API account out of credit | `503` `{ outOfCredit: true }` — off in the same way, pending an operator topping the account up; no retry is offered because none can succeed |
| Path outside the caller's household | `403` |
| Object missing from Storage / empty | `404` / `400` |
| Unsupported file type | `415`, naming the types it takes |
| File past the size cap | `413` with the size and the limit (5 MiB image, 20 MiB PDF, both sized so base64 stays inside the Messages API's per-image and 32 MB request limits) |
| Not a payslip | `422` `{ notPayslip: true, reason }` — the model says so rather than hallucinating a slip |
| Model refusal | `422` — the model declined to read the file; nothing is wrong with the server |
| Upstream rate limit | `429`, so the client can back off |
| Model API error / unusable output | `502` |
| Model timeout | `504` |

Each of these lands in the form as an inline note beside the still-editable
figures, never as a blocked save. Three are singled out by their own flag rather
than their status, because they read differently. `configured: false` and
`outOfCredit: true` are both the feature being **off**, so each shows as a plain
dimmed line rather than an error the member could act on — "Payslip extraction is
not configured. Enter the figures by hand." for the first, and for the second
"Payslip reading is off until the Anthropic account is topped up. Nothing is wrong
with your file — enter the figures by hand.", which names neither a retry (none can
work) nor a fault of the member's. They stay separate flags because the operator's
fix differs: a Vault secret to set, against an account to top up. `notPayslip`
shows the model's own `reason` so the member knows the file was wrong rather than
the reader.
Everything else shows the message the function sent, because that message is the
specific one — the file's size against the limit, the types it takes, how long to
back off — with a plain fallback for a transport failure that never reached the
function at all. The document stays attached through any of them: it is the record,
and the figures are typed either way.

**Retry advice is only given where a retry can work.** A timeout and an upstream
`5xx` are bad moments, so both say to try again. An exhausted balance, an
unreadable model answer, and a request the API rejected outright are not: each says
to enter the figures by hand instead, because the same request would fail the same
way. Telling the two apart at the source is what makes the advice true: an
exhausted balance arrives as a `400 invalid_request_error` — the type every
malformed request carries — so it is recognised by that status, that type, **and**
the credit-balance sentence together, leaving every other bad request to read as
the server fault it is. A spend limit reached is not distinguished from a
request-rate limit, since the API reports them identically; both stay a `429`
telling the member to wait.

Operator setup for the key, and what to do when its account runs out of credit,
are in [`operations.md`](operations.md#anthropic_api_key-setup).

## Resolved decisions

- **Mapping a slip to a projected inflow.** Explicit pickers: the household
  chooses which inflow the slip's cadence is read from and which each earnings
  line draws on, rather than auto-matching on amount and cadence. Nullable
  throughout, so a bonus or back-pay slip — or a line — that matches no
  projection still records.
- **Per-period totals, not shifts.** A line is one earnings line as the slip
  prints it. There is no shift or roster entity: the app models what the payment
  says, not the work behind it.
- **One employer per member.** A member has a single slip stream, so there is no
  per-employer grouping. A mid-year job change is modelled the way a pay rise
  already is — the old inflow ends, a new dated one starts — and each slip points
  at whichever inflow was live for its period.
- **RLS boundary.** Household-wide CRUD, not per-member. Money is fully pooled and
  `member_id` is a tax/reporting tag; the household is the trust boundary that
  protects the documents.
- **Fields.** The gross / withheld / super / net quartet, plus salary sacrifice
  and the slip's YTD running totals, and the slip's earnings lines. Post-tax
  deductions and leave balances are out — they add entry effort and drive no
  variance the quartet does not. YTD figures are stored rather than recomputed,
  so one recent slip anchors the whole year.
- **Withheld is one total, not two components.** The slip's PAYG and STSL lines
  are stored summed, as the slip's own tax total, rather than in a column each.
  Nothing reads them apart: the estimate nets one withheld figure against a
  liability that already includes the HELP repayment, so splitting them would add
  a column two surfaces have to keep adding back up.
- **Extraction.** Built as stage 3 — the `payslip-extract` edge function reads an
  uploaded slip so the form opens pre-filled. It earns its API key by removing the
  only manual cost left, and it stays safe by writing nothing: the member confirms
  every figure, and an unset key leaves manual entry working untouched.

## Open questions

Deferred; not blocking.

- **Period vs YTD as the source of truth.** Prefer summing per-period rows, or
  trust the latest slip's YTD figures (which self-correct for missed entries)?
- **Interaction with Up ingestion.** Once the Up ledger lands, actual net pay
  appears as a deposit transaction. Should payslip `net_cents` be reconciled
  against that deposit, and does payslip withholding data merge with the ledger's
  actual-tax-paid tracking or stay a separate income-side view?
