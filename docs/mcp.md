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
  `api/index.ts`, rewrites in `vercel.json`, custom domain
  `mcp.nest.willsawyerrrr.dev`. Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
  optionally `MCP_ORIGIN` (defaults to the custom domain; set it on previews).
  No service-role key is ever set.

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
| `get_fortnightly_buffer`         | read  | The fortnightly after-saving buffer plus available, outgoings, savings, one-off, and per-group figures, and each member's spending allowance, with its drawn and remaining cents and an `overdrawn` flag for the member's own (null for a co-member's, whose drawn lines are private but still counted in the figures), from the same `summariseHouseholdFromRows` the Summary and Siri use.                  |
| `list_savings_goals`             | read  | Goals with saved, target, remaining, progress percent, target date, and `active` or `queued` status.                                                                                         |
| `list_wishlist`                  | read  | Wishlist items, each tagged with the member's name where set, and the total cost.                                                                                                            |
| `add_wishlist_item`              | write | `name`, `amount_cents` (positive), optional `member` (name) and `note`.                                                                                                                      |
| `create_deduction_from_document` | write | `file_path` (stdio) or base64 `content` and `filename` (HTTP), `category` (`work_expense` default, `donation`, `tax_agent_fees`), optional `member`, and overrides `description`, `amount_cents`, `deduction_date`, `financial_year` (a hint). |

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
| `query_failed`                | A read failed.                                                    |
| `save_failed`                 | A write failed.                                                   |

## Layout and CI

`src/server.ts` registers the tools (the deduction tool's input differs by
transport), `src/http.ts` is the Streamable HTTP handler, `src/auth.ts`
verifies bearer tokens, `api/index.ts` is the Vercel entry, `src/tools/` holds the handlers (pure over
a `NestContext`), `src/session.ts` signs in, and `src/test/fakeContext.ts` is
the in-memory client the tests use. The package is a `pnpm -r typecheck`
member and a Vitest project, so it rides the existing `check` and sharded
`test` jobs without adding a job.
