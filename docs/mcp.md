# MCP server

`packages/mcp` (`@nest/mcp`) is a [Model Context Protocol](https://modelcontextprotocol.io)
server, over stdio locally and over Streamable HTTP remotely. It lets an agent
read the household's figures and add wishlist items and deductions, acting as
one household member.

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
| `add_budget_line` | write | `name`, `group` (`needs`, `wants`, `discretionary`, `savings`, `investments`), `amount_cents`, `frequency` (with `interval_count` for `every_n_weeks` / `every_n_months`, and only for those), optional `management_url` (a bare domain gains `https://`; other schemes are rejected). |
| `update_budget_line` | write | `id` plus any of the same fields; only those given change, and `management_url: null` clears the link. A line derived from a breakdown or gifts is refused (`derived_line`). The database's allowance-overdraw and group constraints apply and surface as `save_failed`. |
| `list_accounts` | read | Accounts from `accounts_with_balance` and `account_directory`: type, source, owner name (null when joint), `balance_cents`, and `exclude_from_net_worth`. A co-member's spending account shows by name only (`balance_visible: false`, null balance); their savers are absent. |
| `set_account_net_worth_exclusion` | write | `account` (id or name), `excluded`. The household-wide flag leaving an account out of net-worth totals only. |
| `list_members` | read | Members' id, name, and `date_of_birth` where recorded; never email. |
| `set_member_date_of_birth` | write | `member` (name or id) and `date_of_birth` (`YYYY-MM-DD`, not in the future) or null to clear, via `set_member_date_of_birth`. |
| `get_household` | read | Household name, timezone, and the pay account. |
| `set_pay_account` | write | `account` (id or name) or null, via `set_household_pay_account`. |
| `list_categories` | read | Income and expense categories with parent; archived only with `include_archived`. |
| `list_transactions` | read | Ledger transactions the member's RLS exposes, newest first (`limit` default 50, max 200), signed `amount_cents`; filters `account`, `kind`, `from` / `to`, and `external_category` (e.g. `gifts-and-charity`, the synced gift candidates). |
| `create_deduction_from_document` | write | `file_path` (stdio) or base64 `content` and `filename` (HTTP), `category` (`work_expense` default, `donation`, `tax_agent_fees`), optional `member`, and overrides `description`, `amount_cents`, `deduction_date`, `financial_year` (a hint). |

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
| `not_found`                   | No household member matches the given name.                       |
| `file_unreadable`             | The path could not be read.                                       |
| `file_too_large`              | Over 25 MiB (stdio) or 3 MiB (HTTP).                              |
| `invalid_content`             | The HTTP `content` is not valid base64.                           |
| `upload_failed`               | Storage refused the file.                                         |
| `extraction_unavailable`      | Reading is off (key unset, out of credit, or key refused).        |
| `extraction_not_receipt`      | The file is not the document the category expects.                |
| `extraction_unsupported_type` | The type cannot be read; supply the three details.                |
| `extraction_failed`           | The read failed for any other reason.                             |
| `incomplete_details`          | The document did not show every detail; the message names those.  |
| `invalid_details`             | The details contradict each other (an interval count without, or missing for, an every-N frequency). |
| `derived_line`                | The budget line is derived from a breakdown or gifts and cannot be edited here. |
| `query_failed`                | A read failed.                                                    |
| `save_failed`                 | A write failed.                                                   |

## Layout and CI

`src/server.ts` registers the tools (the deduction tool's input differs by
transport), `src/http.ts` is the Streamable HTTP handler, `src/auth.ts`
verifies bearer tokens, `src/vercel.ts` is the Vercel entry (bundled over the `api/index.ts` stub by `build:vercel`), `src/tools/` holds the handlers (pure over
a `NestContext`), `src/session.ts` signs in, and `src/test/fakeContext.ts` is
the in-memory client the tests use. The package is a `pnpm -r typecheck`
member and a Vitest project, so it rides the existing `check` and sharded
`test` jobs without adding a job.
