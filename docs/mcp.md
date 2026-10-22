# MCP server

`packages/mcp` (`@nest/mcp`) is a [Model Context Protocol](https://modelcontextprotocol.io)
server, over stdio locally and over Streamable HTTP remotely. It lets an agent
read the household's figures, plan its budget, and add wishlist items and
deductions, acting as one household member.

## Auth

The server signs in as a household member with a Supabase session. It is given
the project's publishable anon key and that member's token; nothing else is
accepted, and a service-role key is never used. Every call goes through
PostgREST, RPC, Storage, or an edge function as that member, so row-level
security gates it exactly as in the PWA (a co-member's spending balances and
savers stay invisible).

| Variable             | Meaning                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `SUPABASE_URL`       | Project URL.                                                      |
| `SUPABASE_ANON_KEY`  | Publishable anon key.                                             |
| `NEST_REFRESH_TOKEN` | The member's refresh token (preferred; keeps the session alive).  |
| `NEST_ACCESS_TOKEN`  | A short-lived access token, used alone when there is no refresh.  |
| `NEST_SESSION_FILE`  | Optional. Defaults to `$XDG_CONFIG_HOME/nest-mcp/session.json`.   |

Supabase rotates a refresh token on every use, so the live session is kept in
the session file (mode `0600`) and resumed on the next run. A different
`NEST_REFRESH_TOKEN` replaces a session started from an older one.

## Remote server

`https://mcp.nest.willsawyerrrr.dev/mcp` serves the same tools over MCP
Streamable HTTP, statelessly: each request builds its own server and answers
with JSON, so nothing is held between requests. Supabase Auth is the OAuth 2.1
authorization server (its OAuth server feature, with dynamic client
registration); the MCP server is only a resource server.

- `GET /.well-known/oauth-protected-resource` names the resource and Supabase
  Auth (`<project>/auth/v1`) as its authorization server.
- A request with no bearer token, or one that does not verify, gets `401` with
  `WWW-Authenticate: Bearer resource_metadata="…"`, which is how a client finds
  the authorization server.
- A token verifies when its signature checks against the project's JWKS, it has
  not expired, its issuer is the project's, and its role is `authenticated`
  (`auth.getClaims`). Each request then builds an anon-key client carrying that
  token and resolves the member behind it, so row-level security applies exactly
  as in the PWA. A signed-in user who is not a household member gets `403`.
- Supabase sends the member to the PWA's `/oauth/consent` page
  (`apps/pwa/src/routes/OAuthConsentSection.tsx`) to approve or deny the app;
  signing in to Nest first returns there.
- Deploy: Vercel project with Root Directory `packages/mcp`, entry
  `src/vercel.ts` bundled over the `api/index.ts` stub by `pnpm run build:vercel`, rewrites in `vercel.json`, custom domain
  `mcp.nest.willsawyerrrr.dev`. Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
  optionally `MCP_ORIGIN` (defaults to the custom domain; set it on previews).
  No service-role key is ever set.
- Static files in `packages/mcp/public/` are served before the rewrites with no
  auth: `index.html` (a short blurb), `favicon.ico`, `favicon.svg`,
  `icon-192.png`, `icon-512.png`, and `apple-touch-icon.png` (the Nest logo,
  copied from `apps/pwa/public/`). Claude reads the connector icon from the
  host's `/favicon.ico`; `robots.txt` allows the icon paths.

### Connecting from Claude

In the Claude desktop app or claude.ai: Settings → Connectors → Add custom
connector, enter `https://mcp.nest.willsawyerrrr.dev/mcp`, then sign in to Nest
with Google and allow the connection.

### One-time Supabase setup

`supabase/config.toml` enables `[auth.oauth_server]` locally; production is set
in the dashboard (Authentication → OAuth Server): enable it, set the
authorization path to `/oauth/consent`, enable dynamic client registration, and
use asymmetric JWT signing keys. The redirect allow-list must permit
`https://nest.willsawyerrrr.dev/**`, since sign-in returns to the consent page.

## Running locally over stdio

```sh
SUPABASE_URL=… SUPABASE_ANON_KEY=… NEST_REFRESH_TOKEN=… node packages/mcp/src/index.ts
```

Node 22.18+ runs the TypeScript sources directly. As an MCP client entry:

```json
{
  "mcpServers": {
    "nest": {
      "command": "node",
      "args": ["/path/to/nest/packages/mcp/src/index.ts"],
      "env": { "SUPABASE_URL": "…", "SUPABASE_ANON_KEY": "…", "NEST_REFRESH_TOKEN": "…" }
    }
  }
}
```

## Tools

Money is always integer cents.

| Tool                             | Kind  | What it does                                                                                                                                                                                 |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_budget_lines`              | read  | Budget lines with fortnightly and annual cents, and the `allowance_member_id` of any allowance a line is drawn from (only the member's own allowance lines are readable); optional case-insensitive `name` filter.                                                                                                     |
| `get_fortnightly_buffer`         | read  | The fortnightly after-saving buffer plus available, outgoings, savings, one-off, and per-group figures, and each member's spending allowance, with its drawn and remaining cents for the member's own (null for a co-member's, whose drawn lines are private), from the same `summariseHouseholdFromRows` the Summary and Siri use.                  |
| `list_savings_goals`             | read  | Goals with saved, target, remaining, progress percent, target date, and `active` or `queued` status.                                                                                         |
| `list_wishlist`                  | read  | Wishlist items, each tagged with the member's name where set, and the total cost.                                                                                                            |
| `add_wishlist_item`              | write | `name`, `amount_cents` (positive), optional `member` (name) and `note`.                                                                                                                      |
| `add_budget_line` | write | `name`, `group` (`needs`, `wants`, `discretionary`, `savings`, `investments`), `amount_cents`, `frequency` (with `interval_count` for `every_n_weeks` / `every_n_months`, and only for those), optional `management_url` (a bare domain gains `https://`; other schemes are rejected), and the links below. |
| `update_budget_line` | write | `id` plus any of the same fields; only those given change, and `management_url: null` clears the link. A line derived from a breakdown or gifts is refused (`derived_line`). `goal_id`, `destination_account_id`, and `allowance_member` also accept `null` to clear. |
| `delete_budget_line` | write | `id` of a manual line. A line derived from a breakdown or gifts is refused (`derived_line`). |
| `list_breakdowns` | read | Breakdowns with their items, fortnightly and annual cents, and the derived `budget_line_id`. |
| `add_breakdown` / `update_breakdown` / `delete_breakdown` | write | A generic breakdown: `name` and `group`. Deleting also removes its items and derived line. |
| `add_breakdown_item` / `update_breakdown_item` / `delete_breakdown_item` | write | An item on a breakdown: `name`, `amount_cents`, `frequency` (with `interval_count` for the `every_n_*` frequencies). |
| `list_member_allowances` | read | Each member's allowance amount, cadence, fortnightly and annual cents, and funding account. |
| `update_member_allowance` | write | `member` (default: the signed-in member), `amount_cents` (may be 0), `frequency` / `interval_count`, `destination_account_id` (`null` clears). Lowering it below what is drawn is refused (`allowance_overdrawn`). |
| `add_savings_goal` / `update_savings_goal` / `delete_savings_goal` | write | `name`, `target_amount_cents`, `target_date`, `current_balance_cents`, `linked_account_id` (a synced savings account), `annual_interest_bps` (0 to 10000), `planned_contribution_cents`; `update` takes `null` to clear the optional ones. Deleting leaves the funding lines, unlinked. |
| `reorder_savings_goal_queue` | write | `goal_ids` first to last; positions become `0..n` and only goals that moved are written. |
| `list_temporary_items` | read | Temporary items with their fortnightly contribution and target date. |
| `add_temporary_item` / `update_temporary_item` / `delete_temporary_item` | write | `name`, `contribution_cents`, `target_date`. |
| `update_wishlist_item` / `delete_wishlist_item` | write | `id` plus any of `name`, `amount_cents` (positive), `member`, `note`; `null` clears `member` or `note`. |
| `list_pay_splits` | read | The pay account and each account's confirmed fortnightly split. |
| `confirm_pay_split` / `clear_pay_split` | write | Records (or clears) the fortnightly cents the household has set in Up for `account_id`. |
| `list_accounts` | read | Accounts from `accounts_with_balance` and `account_directory`: type, source, owner name (null when joint), `balance_cents`, and `exclude_from_net_worth`. A co-member's spending account shows by name only (`balance_visible: false`, null balance); their savers are absent. |
| `set_account_net_worth_exclusion` | write | `account` (id or name), `excluded`. The household-wide flag leaving an account out of net-worth totals only. |
| `list_members` | read | Members' id, name, and `date_of_birth` where recorded; never email. |
| `set_member_date_of_birth` | write | `member` (name or id) and `date_of_birth` (`YYYY-MM-DD`, not in the future) or null to clear, via `set_member_date_of_birth`. |
| `get_household` | read | Household name, timezone, and the pay account. |
| `set_pay_account` | write | `account` (id or name) or null, via `set_household_pay_account`. |
| `list_categories` | read | Income and expense categories with parent; archived only with `include_archived`. |
| `list_transactions` | read | Ledger transactions the member's RLS exposes, newest first (`limit` default 50, max 200), signed `amount_cents`; filters `account`, `kind`, `from` / `to`, and `external_category` (e.g. `gifts-and-charity`, the synced gift candidates). |
| `list_gifts` | read | The gift tracker: recipients (household members are permanent ones, flagged `is_member` / `is_you`), occasions, per-recipient budgets with `spent_cents` and `remaining_cents`, the ad hoc buffer with its spend, unassigned spend, and every purchase the member can see. A budget for the member's own gift reports `private: true` and null spent and remaining, because row-level security hides its purchases. |
| `list_gift_candidates` | read | The "From your card" inbox: synced Up `gifts-and-charity` transactions no purchase claims and nobody dismissed (amount as a magnitude, local posting date, `pending`), and those dismissed with their `dismissal_id`. A co-member's spending account and a transaction claimed as a gift for the member are withheld by row-level security. |
| `add_gift_recipient` / `update_gift_recipient` / `delete_gift_recipient` | write | External recipients only: `name`, or `id` to rename or delete (cascading to their budgets and purchases). A household member's recipient is refused (`member_recipient`). |
| `add_gift_occasion` / `update_gift_occasion` / `delete_gift_occasion` | write | `name` and optional `occasion_date`; update changes only the fields given and `occasion_date: null` clears it; delete cascades to the occasion's budgets and purchases. |
| `add_gift_budget` / `update_gift_budget` / `delete_gift_budget` | write | `recipient_id`, `occasion_id`, `budgeted_amount_cents`, optional `event_date` (overrides the occasion's date); one budget per recipient and occasion. Update changes only the fields given (`event_date: null` clears it); delete cascades to the budget's purchases. |
| `set_gift_discretionary_budget` | write | `budgeted_amount_cents` for the household's single ad hoc gifts buffer, created on first use. |
| `add_gift_purchase` | write | `amount_cents`, `purchased_on`, `description`, and where it counts: `gift_budget_id`, `ad_hoc: true` (against the buffer, with an optional `recipient_id` tag), or neither (unassigned). `transaction_id` from `list_gift_candidates` links a card transaction and takes its amount and date. A purchase for the member's own gift is refused (`private_gift`). |
| `update_gift_purchase` / `delete_gift_purchase` | write | Update changes only the fields given and moves a purchase with `gift_budget_id`, `ad_hoc: true`, or `unassigned: true`; `recipient_id` (null clears) tags an ad hoc one. A linked purchase keeps its transaction's amount and date. A purchase the member cannot see is `not_found`. |
| `dismiss_gift_candidate` / `restore_gift_candidate` | write | Set a candidate's `transaction_id` aside as not a gift, or undo it with the `dismissal_id`. |
| `list_inflows` | read | Inflows, recurring and one-off, with annualised cents for recurring ones; optional case-insensitive `name` filter. |
| `add_inflow` | write | `name`, `type`, and either `schedule` (recurring; `interval_count` for `every_n_*`) or `paid_on` (one-off), plus `taxable` (default true), `member` (required when taxable), `amount_cents` (or `hourly_rate_cents` and `hours_per_period` for a recurring taxable `wage`). Recurring only: `pay_schedule` / `pay_interval_count`, `starts_on` / `ends_on`, `pay_anchor_date`, `attracts_super`, `arrives_every_pay_period`, and `is_joint` with `member_split_percent` (a recurring taxable `other` inflow). A taxable one-off takes `one_off_tax_treatment` (`ordinary` default, `genuine_redundancy` with `years_of_service`, `employment_termination`, `unused_leave`). Type must match taxability, and a one-off carries no cadence fields; contradictions are `invalid_details`. |
| `update_inflow` | write | `id` plus any of the same fields; only those given change. Giving `schedule` or `paid_on` switches between recurring and one-off, dropping the other mode's fields. `null` clears `pay_schedule`, `pay_interval_count`, `starts_on`, `ends_on`, `pay_anchor_date`. |
| `delete_inflow` | write | `id`. |
| `list_tax_profiles` | read | Each member's residency, private hospital cover, and date of birth for a `financial_year` (current by default). |
| `set_tax_profile` | write | `member` (default: the signed-in member), `financial_year`, `residency` (`resident`, `foreign_resident`), `has_private_hospital_cover`; only those given change, a new profile starting as a resident without cover. |
| `list_help_debts` | read | Each member's standing HELP/HECS balance in cents. |
| `set_help_debt` | write | `member`, `balance_cents` (not financial-year scoped). |
| `get_tax_estimate` | read | The household's and each member's gross, taxable income, income tax, Medicare levy and surcharge, HELP repayment, Division 293, after-tax, one-off, and capital-gain cents for a `financial_year`, from the shared `estimateHouseholdTaxFromRows` over inflows, tax profiles, HELP debts, super contributions, deductions, and trades. Payslip withholding and savings-goal interest are not included. A year with no published tax config is `invalid_details`. |
| `list_super_profiles` | read | Each member's fund name, linked account, balance cents, and `balance_as_of` for a `financial_year`. |
| `set_super_profile` | write | `member`, `financial_year`, `balance_cents`, optional `fund_name` (kept if omitted, cleared if null or empty). Creates and links a manual savings account when there is none, writes its balance, and records today as the true-up, as the Super tab does. |
| `list_super_contributions` | read | A `financial_year`'s contributions, optionally for one `member`. |
| `add_super_contribution` | write | `kind` (`salary_sacrifice`, `personal_deductible`, `personal_non_concessional`, `spouse` with a `contributor`), `mode` (`amount` with `amount_cents`, or `percent` with `percent_bp`), `frequency` (with `interval_count` for `every_n_*`), `fhss_eligible`, `member`, `financial_year`. |
| `update_super_contribution` | write | `id` plus any of the same fields (not member or year); switching `mode` needs the new mode's figure. |
| `delete_super_contribution` | write | `id`. |
| `list_equity_grants` | read | Equity grants with vested, exercised, sold, unexercised-vested, and held-share quantities, and the net-worth value as of today (unexercised vested options at their gain over the strike, held shares at the price per share). |
| `add_equity_grant` | write | `label`, `instrument_type` (`option`, `share`), `quantity`, `grant_date`, optional `member`, `cliff_months` (12), `vesting_period_months` (48), `vesting_frequency` (`monthly`), `strike_price_cents` (options only), `price_per_share_cents`, `price_as_of`. |
| `update_equity_grant` | write | `id` plus any of the same fields; `null` clears `strike_price_cents` and `price_as_of`. |
| `delete_equity_grant` | write | `id`. |
| `record_equity_exercise` | write | `grant_id` (an option grant), `exercised_on`, `quantity` (whole options), optional `strike_price_cents` (the grant's by default) and `market_price_per_share_cents`. Refused beyond the options left to exercise (`invalid_details`). |
| `record_equity_sale` | write | `grant_id`, `sold_on`, `quantity` (whole shares: exercised options, or granted shares for a share grant), `price_per_share_cents`, optional `fee_cents`. Refused beyond the shares held (`invalid_details`). A capital-gains event in the tax estimate. |
| `delete_equity_exercise` / `delete_equity_sale` | write | `id`. |
| `create_deduction_from_document` | write | `file_path` (stdio) or base64 `content` and `filename` (HTTP), `category` (`work_expense` default, `donation`, `tax_agent_fees`), optional `member`, and overrides `description`, `amount_cents`, `deduction_date`, `financial_year` (a hint). |
| `list_deductions` | read | Deductions for `financial_year` (default current) with basis, claimed and full cents, work use, group, and `has_receipt`; optional `member` and `category`. |
| `add_deduction` | write | `description`, `deduction_date`, `category`, `member`, `group_id`, and a `basis`: `amount` (`amount_cents` is the full cost; `work_use_percent` for work expenses), `distance` (`distance_km`), or `hours` (`work_from_home_hours`). Distance and hours are work expenses priced at the year's published ATO rate, snapshotted into `amount_cents`; a distance past the ATO cap returns a `warning`. A donation is filed automatically in the donations group. |
| `update_deduction` | write | `id` plus any of `description`, `deduction_date`, the basis's own inputs, and `group_id` (`null` ungroups). Category and basis are fixed; the claim is recomputed. |
| `delete_deduction` | write | `id`; also removes the stored receipt. |
| `attach_deduction_receipt` | write | `id` plus `file_path` (stdio) or base64 `content` and `filename` (HTTP); stores the file in `receipts` under the Uploads rules and replaces any earlier receipt. Nothing is read from it. |
| `remove_deduction_receipt` | write | `id`; clears the receipt row and file. |
| `list_deduction_groups` | read | Groups for `financial_year` with kind, payment count, and summed total. |
| `create_deduction_group` / `update_deduction_group` / `delete_deduction_group` | write | Standard groups only: `name`, optional `member` and `financial_year`; deleting ungroups the payments. The donations group is read-only (`automatic_group`). |
| `list_trades` | read | Trades newest first (units, `price_per_unit_microdollars`, `fee_cents`, whether a document is attached); optional `member` and `ticker` filters. |
| `list_holdings` | read | Holdings FIFO-matched from all trades per member and ticker, with units, cost base and value in cents at the last traded price, and any oversold units; optional `member`. |
| `add_trade` | write | `ticker`, `side`, `traded_on`, `units` (positive, at most six decimals), `price_per_unit_microdollars` (integer; $33.083072 is `33083072`), optional `fee_cents` and `member`. |
| `update_trade` | write | `id` plus any of ticker, side, date, units, price, fee; only those given change. |
| `delete_trade` | write | `id`. |
| `create_trades_from_document` | write | `file_path` (stdio) or base64 `content` and `filename` (HTTP), optional `member` and `financial_year` (a hint). Stores the contract note, confirmation, or statement in `receipts`, reads every trade with `trade-extract`, and writes the document and trades with `create_trades_with_document`. A document that does not fully show every trade (`incomplete_details`) records nothing and the file is deleted. Returns `possible_duplicates` (ids of trades that repeat an existing one); read values are AI-extracted and should be checked. |
| `list_payslips` | read | Payslips with their lines, newest pay period first; optional `financial_year` and `member` filters. |
| `create_payslip` | write | `period_start`, `period_end`, `gross_cents`, `tax_withheld_cents`, `super_cents`, `net_cents`, optional `paid_on`, `salary_sacrifice_cents`, `ytd_*_cents`, `note`, `member`, and `lines` (an `earning` with an optional `source_inflow_id`, or a `tax` line with `tax_component` `payg` or `stsl`). Written with `upsert_payslip_with_lines`; the financial year is derived from `paid_on`, else `period_end`. |
| `update_payslip` | write | `id` plus any of the same fields (`null` clears the optional ones); `lines` given replace the set, omitted they stay; the document is kept. |
| `delete_payslip` | write | `id`; removes the slip, its lines, and its stored document. |
| `attach_payslip_document` | write | `id` plus `file_path` (stdio) or `content` and `filename` (HTTP); stores it in the `payslips` bucket, replacing any earlier document. |
| `remove_payslip_document` | write | `id`; clears the document and deletes the object. |
| `create_payslip_from_document` | write | A payslip file as above, plus any figures to override; the rest are read with `payslip-extract` (AI; check them). Lines read from the document are returned, not saved: pass them as `lines` (or to `update_payslip`) naming each earning's inflow and each tax line's component. A failure after the upload deletes the stored file. |

Budget-line links: `goal_id` funds a goal (savings and investments lines only),
`destination_account_id` routes any other line to an account, and
`allowance_member` (the member's own name, discretionary lines only) draws the
line from their allowance, which funds it, so it takes no destination of its
own. A group that cannot carry a link clears it when the line moves there.
The tools pre-validate these (`invalid_details`, `not_found`, `invalid_account`)
and the database's constraints back them up.

### Not exposed

Credentials and outward-facing surfaces are deliberately absent: Up and Redbark
tokens and connect/disconnect, push subscriptions and VAPID keys, calendar feed
tokens, EOFY share grants, invite codes, creating or joining a household, Vault
RPCs, and any service-role-only function. There is no net-worth tool: the total
is assembled in the PWA from super, equity, and HELP data as well as accounts.

The buffer is computed over rows the member can see. A goal's projected
interest linked to a co-member's saver is therefore left out of the estimate,
which can differ from the Summary by that interest.

### `create_deduction_from_document`

1. Reads the document: over stdio the local `file_path` (at most 25 MiB); over
   HTTP the base64 `content` named `filename` (at most 3 MiB decoded, which
   keeps the request inside Vercel's 4.5 MB body limit). Any type is accepted,
   with the same rules as the PWA's `uploadFile.ts`: the extension alone picks
   the stored content type, and only PDF, JPEG, PNG, GIF, and WebP are read.
2. Uploads it to the `receipts` bucket as
   `<household_id>/<deduction_id>/<uuid>-<name>` under a minted id.
3. Unless `description`, `amount_cents`, and `deduction_date` are all given,
   calls `deduction-extract` (primed with the category) to fill the rest.
   Given values always win.
4. Writes the deduction and its receipt in one transaction with
   `create_deduction_with_receipt`. The financial year is the one the date
   falls in.

Values read from the document are AI-extracted and should be checked against
it; the result lists which fields they were. Any failure after the upload
deletes the stored file.

## Errors

A failed tool call returns `isError` with `{ "code", "message" }`. The message
is fixed copy; what Storage, PostgREST, or an edge function said is never
relayed.

| Code                          | Meaning                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `not_found`                   | No household member, or no record with the given id, matches.     |
| `file_unreadable`             | The path could not be read.                                       |
| `file_too_large`              | Over 25 MiB (stdio) or 3 MiB (HTTP).                              |
| `invalid_content`             | The HTTP `content` is not valid base64.                           |
| `upload_failed`               | Storage refused the file.                                         |
| `extraction_unavailable`      | Reading is off (key unset, out of credit, or key refused).        |
| `extraction_not_receipt`      | The file is not the document the category expects.                |
| `extraction_unsupported_type` | The type cannot be read; supply the three details.                |
| `extraction_failed`           | The read failed for any other reason.                             |
| `extraction_not_trade_document` | The file shows no trades. |
| `extraction_not_payslip`      | The file is not a payslip.                                        |
| `incomplete_details`          | The document did not show every detail; the message names those.  |
| `invalid_details`             | The details contradict each other or break a rule the PWA's forms and the database checks enforce (an interval count without, or missing for, an every-N frequency; a one-off with a cadence; a joint inflow that is not a recurring taxable `other`). |
| `derived_line`                | The budget line is derived from a breakdown or gifts and cannot be edited here. |
| `member_recipient`            | A household member's gift recipient is permanent and cannot be edited or deleted. |
| `private_gift`                | The purchase is for the member's own gift, which is hidden from them.             |
| `allowance_overdrawn`         | The write would leave an allowance with less than is drawn from it. |
| `invalid_account`             | The account is unknown, not a synced saver for a goal, or not a transaction account for the pay account. |
| `automatic_group`             | The donations group is automatic and cannot be filed into, renamed, or deleted. |
| `query_failed`                | A read failed.                                                    |
| `save_failed`                 | A write failed.                                                   |
| `delete_failed`               | A delete failed.                                                  |

## Layout and CI

`src/server.ts` registers the tools (the deduction tool's input differs by
transport; `src/tools/planningTools.ts` registers the budget-planning ones), `src/http.ts` is the Streamable HTTP handler, `src/auth.ts`
verifies bearer tokens, `src/vercel.ts` is the Vercel entry (bundled over the `api/index.ts` stub by `build:vercel`), `src/tools/` holds the handlers (pure over
a `NestContext`), `src/session.ts` signs in, and `src/test/fakeContext.ts` is
the in-memory client the tests use. The package is a `pnpm -r typecheck`
member and a Vitest project, so it rides the existing `check` and sharded
`test` jobs without adding a job.
