# Investments: share and ETF trades

Members record buys and sells of listed shares and ETFs by hand. Holdings, cost
base, realised gains, and the net capital gain the tax estimate assesses are all
**derived** from the trade rows — nothing derived is stored, so editing or
deleting a trade recalculates every figure. The math is pure, in `@nest/tax`
(`capitalGains.ts`); the schema is the `trade` table in
[`data-model.md`](data-model.md#share-and-etf-trades).

Amounts are integer cents; units may be fractional (up to six decimal places).

## Recording trades

The Investments tab (`/investments`, under Grow) lists each member's trades with
add / edit / delete: side (buy or sell), ticker (stored upper-case), date, units,
price per unit, and brokerage fee. A trade belongs to one member; holdings are
per member and ticker.

Trades carry `source` (`manual` by default) and `external_id`, unique together
exactly as `transactions` is, so a later brokerage import (the SnapTrade rail in
[`redbark-ingestion.md`](redbark-ingestion.md#brokerage-rail-out-of-scope-unbuilt))
can upsert its own trades without duplicating.

## Holdings

Each member's holding of a ticker is the units left after matching sales to
purchases. The tab shows units, **cost base** (the unsold parcels' cost,
brokerage included), **average cost** (cost base per unit, to the cent), and
market value.

## Parcel matching

Sales are matched to purchase parcels **first-in first-out** (FIFO), per member
and ticker. Trades are processed by date, a buy before a sell on the same day.
A parcel part-sold carries its remaining cost base forward; rounding remainders
land on the last piece so a sale's proceeds and a parcel's cost are each
allocated exactly.

- A buy's cost base is `units × price + brokerage`.
- A sell's proceeds are `units × price − brokerage`, shared across the parcels it
  consumes in proportion to the units taken from each.
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
