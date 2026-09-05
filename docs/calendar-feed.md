# Calendar feed

Putting the household's money dates into whatever calendar app its members
already use, as a **read-only iCalendar (`.ics`) feed** they subscribe to by
URL. No Google Calendar write scope, no consent-screen change: the feed is
anonymous, resolved by a bearer token the household mints on the Connections
settings page.

## Decision: a subscribable `.ics` URL, not calendar write access

- **Not OAuth write access.** Writing events into a member's Google Calendar
  needs a write scope, a published consent screen, per-member authorisation,
  and a reconciliation loop to keep the app's events and the calendar's copy in
  step. A subscription the calendar app pulls on its own schedule needs none of
  that, and works the same for Apple Calendar, Outlook, and anything else that
  speaks iCalendar.
- **A bearer token, not a member.** The reader is a calendar server with no
  Supabase session, so the token in the URL is the whole credential — the same
  shape [EOFY sharing](eofy-sharing.md) uses, without the expiry, since a
  subscription refreshes indefinitely.

## Data model

`calendar_feed` — one row per household (`household_id` is the primary key):

| column       | notes                                                          |
| ------------ | -------------------------------------------------------------- |
| `household_id` | primary key, `references households on delete cascade`      |
| `token_hash` | `sha256(token)` hex; the plaintext is returned once, never stored |
| `created_at` | when the live token was last minted                            |

- `create_calendar_feed_token()` mints (or replaces) the token and returns the
  plaintext once; `revoke_calendar_feed_token()` deletes the row. Both are
  SECURITY DEFINER with `set search_path = ''`, `execute` granted to
  `authenticated`.
- A column-level `select` grant gives `authenticated` `household_id` and
  `created_at` only — never `token_hash`. RLS scopes the row to household
  members; there is no insert/update/delete policy or grant, so every write goes
  through the two RPCs.
- `service_role` holds `select` on `calendar_feed` (to resolve a token) and on
  `households` (for the calendar name); `inflows`, `savings_goal`, and
  `temporary_item` were already granted for other anonymous read paths. See
  [`operations.md`](operations.md#service_role-grants).

## Edge function

`calendar-ics` runs `verify_jwt = false`. It reads the token from a trailing
path segment or `?token=`, hashes it (`_shared/calendarFeed.ts`), and looks
`calendar_feed` up by `token_hash` with a service-role client. A missing,
malformed, or unknown token all get an identical bare `404`. On a match it
serves `Content-Type: text/calendar; charset=utf-8`.

### Events

All-day (`DTSTART;VALUE=DATE`), over a rolling **−1 month … +12 months** window,
each with a deterministic `<kind>-<rowId>-<date>@nest` `UID` so a re-fetch
updates an event in place rather than duplicating it:

- **Expected inflow deposits** — for each recurring inflow, its occurrences
  stepped from the pay cadence (`pay_schedule` + `pay_interval_count`, else
  `schedule` + `interval_count`), clipped to `starts_on` / `ends_on`. An inflow
  with no usable cadence is skipped. The cadence is anchored on `pay_anchor_date`
  when the household has confirmed one, else on `starts_on`, else on a fixed
  financial-year epoch, so an inflow with neither stays put between fetches even
  though the projection stores no real payday for it.
- **One-off inflows** — a single event on `paid_on`.
- **Savings-goal and temporary-item target dates** — one event each.
- **Financial-year boundary** — 30 June (year ends) and 1 July (new FY — review
  tax settings), for every year the window spans.

Event derivation and the small inline ICS serialiser (RFC 5545 text escaping
and 75-octet line folding, no dependency) are the pure, DI-tested
`calendar-ics/events.ts`; `feed.ts` is the resolve-token-before-any-read flow;
`index.ts` wires the service-role reads.

## Frontend

The Connections settings page's **Calendar feed** card: *Generate* mints the token and shows
the `https://…/calendar-ics?token=…` URL and its `webcal://` twin once, with
copy buttons and a one-line "Subscribe from URL" hint. *Regenerate* mints a
fresh token (the old URL stops resolving); *Revoke* deletes it. The plaintext
URL is never stored, so a page revisit shows the feed as active but offers no
copy button. `useCalendarFeed` wraps the RPCs and the row read.
