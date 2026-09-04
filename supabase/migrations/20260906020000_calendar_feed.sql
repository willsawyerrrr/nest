-- Calendar feed: a read-only, subscribable ICS URL a household points its
-- calendar app at, so its money dates — expected inflow deposits, savings-goal
-- and temporary-item target dates, and the financial-year boundary — sit
-- alongside everything else its members already keep in that calendar. Not a
-- Google Calendar write scope and no consent-screen change: the feed is
-- anonymous, resolved by a bearer token the household mints, the same shape
-- `share_grant` (EOFY sharing) follows.
--
-- At most one live token per household: `household_id` is the primary key, so
-- `create_calendar_feed_token` replaces any existing token rather than adding a
-- second, and `revoke_calendar_feed_token` deletes the row outright rather than
-- flagging it. The plaintext token is returned once and never stored — only
-- `sha256(token)` hex, matched by the `calendar-ics` edge function with a
-- service-role client.

create table public.calendar_feed (
  household_id uuid primary key references public.households on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
comment on table public.calendar_feed is 'At most one live calendar-feed bearer token per household. Not a household membership — a bearer credential for an anonymous, read-only ICS feed (calendar-ics), following the same token-hash idiom as share_grant.';
comment on column public.calendar_feed.token_hash is 'sha256(token), hex. The plaintext token is returned once by create_calendar_feed_token and never stored; only the hash is compared when the feed is fetched.';

-- ── Row-Level Security ───────────────────────────────────────────────────────
--
-- Mirrors share_grant: household members may read their own feed row (never
-- token_hash, the credential itself), and there is no insert/update/delete
-- policy and no such GRANT — every write goes through the SECURITY DEFINER
-- RPCs, so a direct PostgREST write is impossible.

alter table public.calendar_feed enable row level security;

create policy "household members read their calendar feed" on public.calendar_feed
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

revoke select on public.calendar_feed from authenticated;
grant select (household_id, created_at) on public.calendar_feed to authenticated;

-- calendar-ics resolves a token with a service-role client, reading token_hash
-- to match it — the one path that needs it.
grant select on public.calendar_feed to service_role;

-- calendar-ics also reads the tables whose dated rows become events, with a
-- service-role client (an anonymous feed holder has no `auth.uid()` for those
-- tables' RLS to match). `inflows`, `savings_goal`, and `temporary_item` are
-- already granted to `service_role` (the EOFY-share and notification-evaluator
-- paths); `households` joins them, for the feed's calendar name.
grant select on public.households to service_role;

-- ── RPCs ──────────────────────────────────────────────────────────────────────

create function public.create_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  insert into public.calendar_feed (household_id, token_hash)
    values (v_household_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
    on conflict (household_id) do update set
      token_hash = excluded.token_hash,
      created_at = now();

  return v_token;
end;
$$;

comment on function public.create_calendar_feed_token() is 'Mints (or replaces) the caller''s household''s single calendar-feed token: a 64-hex-char bearer token with no expiry. Returns the plaintext token once — only its hash is stored.';

revoke execute on function public.create_calendar_feed_token() from public;
grant execute on function public.create_calendar_feed_token() to authenticated;

create function public.revoke_calendar_feed_token()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  delete from public.calendar_feed where household_id = v_household_id;
end;
$$;

comment on function public.revoke_calendar_feed_token() is 'Deletes the caller''s household''s calendar-feed token, if any. A no-op when there is none.';

revoke execute on function public.revoke_calendar_feed_token() from public;
grant execute on function public.revoke_calendar_feed_token() to authenticated;
