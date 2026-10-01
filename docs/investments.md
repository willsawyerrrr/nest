# Investments: share and ETF trades

Members record buys and sells of listed shares and ETFs by hand. Holdings, cost
base, realised gains, and the net capital gain the tax estimate assesses are all
**derived** from the trade rows — nothing derived is stored, so editing or
deleting a trade recalculates every figure. The math is pure, in `@nest/tax`
(`capitalGains.ts`); the schema is the `trade` table in
[`data-model.md`](data-model.md#share-and-etf-trades).

Amounts are integer cents, with one exception: a **unit price** is held exactly,
as integer **microdollars** (millionths of a dollar; 10,000 per cent), because a
broker prints a security's average price to six decimal places (`33.083072`).
Units may be fractional (up to six decimal places). See [Exact unit
prices](#exact-unit-prices).

## Exact unit prices

`trade.price_per_unit_microdollars` is a `bigint`: `$33.083072` is `33083072`,
`$98.50` is `98500000`. An integer column keeps the price exact end to end — no
float or decimal sits between the database, the edge function, and `@nest/tax`.
Everything else in the schema (deductions, income, fees) stays in integer cents;
securities are the only place sub-cent amounts arise. The price has at most six
decimal places; the trade form, the document reader, and the column all refuse more
rather than round.

All arithmetic on a price is integer, in `BigInt` where a product can pass 2^53
(`@nest/tax`'s `unitPrice.ts`), and rounds to whole cents **half-up, once per
trade**, at the point a dollar figure is produced:

- A trade's **consideration** is `units × price`, rounded to the cent. This is the
  figure a contract note prints (`2 × 33.083072 = 66.166144` → `$66.17`), so a
  buy's cost base and a sell's proceeds reconcile with the note's total cost and
  net proceeds to the cent.
- A buy's cost is `consideration + brokerage`; a sell's proceeds are
  `consideration − brokerage`. Both are whole cents from here on.
- A parcel part-sold or a sale spread over several parcels is split in proportion
  to the units taken, each share rounded half-up, with the remainder on the last
  piece, so the pieces always sum to the parcel's cost and the sale's proceeds.
- A holding's **market value** is `units × last traded price`, rounded once to the
  cent. Its **average cost** is cost base per unit, kept as a unit price in
  microdollars and shown to as many places as it needs (up to six).
- Realised gains, the CGT discount, and net worth are sums of whole-cent figures.

## Recording trades

The Investments tab (`/investments`, under Grow) lists each member's trades with
add / edit / delete: side (buy or sell), ticker (stored upper-case), date, units,
price per unit, and brokerage fee. A trade belongs to one member; holdings are
per member and ticker.

Trades, holdings, and realised gains use the same compact list-row style as the
budget lines: a dense row from the `sm` breakpoint up, with columns that line up
across rows, and a bordered card below it. A trade row reads side pill and
ticker (never truncated), then muted date, units (`1 unit`, `1.5 units`), and
exact price (`at $33.083072`), then the brokerage as an outlined pill showing
just the fee (`$9.50`, titled `Brokerage $9.50`; an em dash when there is none),
then the trade value (units at price, before brokerage) right-aligned beside the
**Document** icon (when the trade was read from a document), edit, and delete
controls. The card reads the same facts as one muted line (`$9.50 brokerage`),
with a **Document** link beside the ticker. Holdings and each financial year's
gains read as a title, muted figures, and a right-aligned figure.

Trades carry `source` (`manual` by default) and `external_id`, unique together
exactly as `transactions` is, so a later brokerage import (the SnapTrade rail in
[`redbark-ingestion.md`](redbark-ingestion.md#brokerage-rail-out-of-scope-unbuilt))
can upsert its own trades without duplicating.

## Adding trades from a document

The **Add trade** card opens on a **Contract notes** prompt, as the Add deduction
card opens on a receipt prompt: the trade's fields appear when the member chooses
**Enter details manually**, or once a file has been read or could not be. One file is stored, read by `trade-extract`, and
its trade opens in the card's form (ticker, side, date, units, price, brokerage)
with a note that AI read it and a note naming any field to check; the member
confirms and saves, and the document stays attached to the saved trade
(`create_trades_with_document`). A type that cannot be read, or a failed or
switched-off read, shows its fixed note and leaves the document attached for hand
entry. Remove, or pick another file, deletes the stored file; leaving the card
deletes it unless a trade was saved. Saving is held while the file is stored or
read. The card accepts one or many files (multi-select or drop): several files, or
one document holding several trades, replace the form with the review below, each
trade a draft, and **Close** ends the card. Editing a trade does not take a
document: a document is only attached when a trade is created.

The member picks broker contract notes, trade confirmations, or statements —
several at once, or dropped on the card (any file, up to 25 MiB each; see
[`bulk-upload.md`](bulk-upload.md)). Each file is uploaded to the private `receipts` bucket, laid out as
`<household_id>/<document_id>/<file>`, and read by the `trade-extract` edge
function (Claude Haiku 4.5, forced tool schema, the Vault-held `anthropic_api_key`
the payslip and deduction extractors use). A document can hold several trades, so
the answer is a list: each trade becomes its own **draft** form, pre-filled with
ticker, side, date, units (up to six decimal places), price per unit, and
brokerage fee. The owning member is the section the button sits in, never read
from the document.

Only a PDF or a JPEG, PNG, GIF, or WebP image is read. Any other type of file is
still stored and linked, with a note that it cannot be read automatically, and
the card offers one blank trade form to fill in by hand; a HEIC photo is
converted to JPEG in the browser where possible and then read.

- Extraction writes nothing. Each draft is the member's to **save**, edit, or
  **discard**; the first save stores the document, and the rest reuse it.
- Units and money are the literal printed text, converted in TypeScript: a price
  to integer microdollars (`33.083072` → `33083072`), the brokerage fee to integer
  cents, units to a number of at most six decimal places. A price finer than six
  decimal places (`33.0830721`) is flagged for the member to enter rather than
  rounded; zeros past the sixth place (`35.7900000`) are dropped. An absent
  brokerage fee is nil.
- **CommSec contract notes** are read as printed: the ticker is the code under the
  security name, the side is “We have bought” / “We have sold”, the date is
  `DATE:` (never the settlement date), units are `TOTAL UNITS`, and the price is
  the six-decimal `AVERAGE PRICE` (several fills are summarised by it).
- **Brokerage is the fee including GST.** CommSec prints `BROKERAGE & COSTS INCL
  GST` (`$2.00`) and a separate `TOTAL GST` (`$0.18`, already inside the $2.00);
  the fee is the first, and the GST line is never added or subtracted. For an
  individual not registered for GST, GST on brokerage is not claimable as an
  input tax credit, so the whole amount is an incidental cost of acquiring or
  disposing of the asset (ITAA 1997 s 110-25(4)): it joins a buy's cost base and
  comes off a sell's proceeds, as the contract note's `TOTAL COST` and
  `NET PROCEEDS` already do. Where another broker prints only an ex-GST
  brokerage figure, that figure is read; nothing is derived.
- A field the document did not show, or showed in a form that could not be read
  safely, is left blank and named in a note on the draft.
- A date printed without a year resolves within the financial year the trades are
  being added to (the current financial year), as for payslips and deduction
  receipts.
- A draft that matches an existing trade of the same member, ticker, date, units,
  and price shows a warning. It does not block saving: two identical fills on one
  day are legitimate. The same warning shows when adding or editing by hand.
- A document with no saved trade is deleted again when its drafts are discarded or
  the card is closed, so a failed or abandoned read leaves nothing behind.
- Each document is its own entry in the batch, with its own status and its own set
  of trade drafts. **Save selected** saves the valid drafts across documents; a
  draft with a blank required field is reported instead of saved. A retried save
  reuses each trade's and document's id, so nothing duplicates.

### Where the document lives

Saved trades keep the document they were read from. The `trade_document` table
holds one row per stored document (`storage_path` into the `receipts` bucket), and
`trade.document_id` points at it — a statement's trades share one row. The trade
row shows a **Document** link that opens the file through a short-lived signed
URL. The `create_trades_with_document` function writes the document row and the
confirmed trade together in one transaction, keyed on ids minted in the browser so
a retried save does not duplicate either. Deleting a trade leaves the stored file and its row: the document remains the
record for any other trade read from it.

A trade read from a document stays `source = 'manual'` with a null `external_id`:
those columns are a brokerage import's idempotency key, and every extracted trade
is confirmed by hand, so `document_id` is the only mark that a trade was extracted.

### Failures

`trade-extract` answers every failure with a stable `code` and fixed copy of its
own; nothing the model or the Anthropic API said reaches the client, and the
upstream detail is logged server-side. The card shows the message and falls back
to manual entry. See
[`supabase/functions/README.md`](../supabase/functions/README.md#trade-extraction).

## Holdings

Each member's holding of a ticker is the units left after matching sales to
purchases. The tab shows units, **cost base** (the unsold parcels' cost,
brokerage included), **average cost** (cost base per unit, to up to six decimal
places), and market value.

## Parcel matching

Sales are matched to purchase parcels **first-in first-out** (FIFO), per member
and ticker. Trades are processed by date, a buy before a sell on the same day.
A parcel part-sold carries its remaining cost base forward; rounding remainders
land on the last piece so a sale's proceeds and a parcel's cost are each
allocated exactly.

- A buy's cost base is `units × price + brokerage`, the product rounded to the
  cent once (see [Exact unit prices](#exact-unit-prices)); brokerage is the fee
  including GST.
- A sell's proceeds are `units × price − brokerage`, rounded the same way and
  shared across the parcels it consumes in proportion to the units taken from
  each.
- Units sold beyond the recorded buys are left out of every gain and flagged on
  the tab so the trades can be corrected.

## Realised gains and the CGT discount

Each matched piece is a realised gain or loss in the financial year its sale falls
in. A parcel held for **more than 12 months** (the sell date after the first
anniversary of the buy date) is eligible for the **50% CGT discount**.

A member's net capital gain for a year (`capitalGainsSummary`):

1. Capital losses — the year's, plus any net capital loss carried forward from
   earlier years — are set against gains not eligible for the discount first,
   then against discount-eligible gains.
2. The 50% discount applies to what remains of the discount-eligible gains.
3. The result is floored at zero. A year whose losses outrun its gains has a nil
   net capital gain and carries the excess forward.

The discount is applied for every member regardless of residency, and no other
asset class or CGT concession is modelled.

## Tax estimate

`@nest/tax`'s `estimateHouseholdTax` takes a net-capital-gain-per-member input
(`netCapitalGainByMember`), carried on `AssessableIncome.netCapitalGainCents`. It
is assessable income like any other, so it lifts taxable income and every figure
that assesses it. `@nest/household`'s `estimateHouseholdTaxFromRows` takes the
household's trades and supplies it for the estimate's financial year.

Each member's estimate reports `annualNetCapitalGainCents` and
`annualCapitalGainTaxCents` (the liability with the gain less the liability
without). Like one-off money, the gain is in the annual figures and **out of the
fortnightly ones**: a gain realised on a sale has no fortnightly share to plan
against. The Summary and budget read no trades, so they are unaffected.

The Tax tab shows the net capital gain as a detail line under gross income in the
breakdown and a note on the card; the EOFY tab shows a Net capital gain line in
each member's tax figures when they have one. The `eofy-share` function serves
the household's trades (unfiltered by financial year, since a sale is matched
against earlier purchases) so the shared view estimates the same figure.

## Net worth

Each member's holdings count toward net worth in the Equity group, valued at the
**last traded price** of the ticker — the most recent trade of it by any member,
a buy or a sell. Shares and ETFs do not vest and no return is assumed on them, so
the projection holds them flat (`heldEquityCents` in `@nest/plan`'s
`projectNetWorth`).
