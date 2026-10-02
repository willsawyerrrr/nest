# MCP server

`packages/mcp` (`@nest/mcp`) is a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio. It lets an agent read the household's figures and add
wishlist items and deductions, acting as one household member.

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

## Running

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
| `list_budget_lines`              | read  | Budget lines with fortnightly and annual cents; optional case-insensitive `name` filter.                                                                                                     |
| `get_fortnightly_buffer`         | read  | The fortnightly after-saving buffer plus available, outgoings, savings, one-off, and per-group figures, from the same `summariseHouseholdFromRows` the Summary and Siri use.                  |
| `list_savings_goals`             | read  | Goals with saved, target, remaining, progress percent, target date, and `active` or `queued` status.                                                                                         |
| `list_wishlist`                  | read  | Wishlist items, each tagged with the member's name where set, and the total cost.                                                                                                            |
| `add_wishlist_item`              | write | `name`, `amount_cents` (positive), optional `member` (name) and `note`.                                                                                                                      |
| `create_deduction_from_document` | write | `file_path`, `category` (`work_expense` default, `donation`, `tax_agent_fees`), optional `member`, and overrides `description`, `amount_cents`, `deduction_date`, `financial_year` (a hint). |

The buffer is computed over rows the member can see. A goal's projected
interest linked to a co-member's saver is therefore left out of the estimate,
which can differ from the Summary by that interest.

### `create_deduction_from_document`

1. Reads the local file (any type, at most 25 MiB; the same rules as the
   PWA's `uploadFile.ts`: the extension alone picks the stored content type,
   and only PDF, JPEG, PNG, GIF, and WebP are read).
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
| `file_too_large`              | Over 25 MiB.                                                      |
| `upload_failed`               | Storage refused the file.                                         |
| `extraction_unavailable`      | Reading is off (key unset, out of credit, or key refused).        |
| `extraction_not_receipt`      | The file is not the document the category expects.                |
| `extraction_unsupported_type` | The type cannot be read; supply the three details.                |
| `extraction_failed`           | The read failed for any other reason.                             |
| `incomplete_details`          | The document did not show every detail; the message names those.  |
| `query_failed`                | A read failed.                                                    |
| `save_failed`                 | A write failed.                                                   |

## Layout and CI

`src/server.ts` registers the tools, `src/tools/` holds the handlers (pure over
a `NestContext`), `src/session.ts` signs in, and `src/test/fakeContext.ts` is
the in-memory client the tests use. The package is a `pnpm -r typecheck`
member and a Vitest project, so it rides the existing `check` and sharded
`test` jobs without adding a job.
