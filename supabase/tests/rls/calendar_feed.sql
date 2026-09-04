-- Assertions for the calendar-feed token table and its RPCs.
--
-- `create_calendar_feed_token` mints (or replaces) the caller's household's
-- single feed token; `revoke_calendar_feed_token` deletes it. Both are
-- SECURITY DEFINER, so a direct PostgREST write to `calendar_feed` must be
-- impossible, and `token_hash` — the credential itself — must never be
-- selectable by `authenticated`, only `household_id` and `created_at`.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cal-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cal-bob@example.com');

-- ── Alice's household ─────────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"cal-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as db_hid \gset
select set_config('db.hid', :'db_hid', false);

do $$ begin
  assert (select count(*) from public.calendar_feed where household_id = current_setting('db.hid')::uuid) = 0,
    'a fresh household should have no calendar feed';
end $$;

select public.create_calendar_feed_token() as db_token1 \gset
select set_config('db.token1', :'db_token1', false);

-- A second call replaces the row rather than adding a second one, and mints a
-- different token.
select public.create_calendar_feed_token() as db_token2 \gset
select set_config('db.token2', :'db_token2', false);

-- Verify the stored hash as the table owner: `authenticated` cannot read
-- `token_hash` at all (asserted below), so the "only the sha256 is stored"
-- check has to run outside that role.
reset role;
do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert length(current_setting('db.token1')) = 64,
    'the returned token should be 64 hex characters';
  assert current_setting('db.token1') <> current_setting('db.token2'),
    'each call should mint a fresh token';
  assert (select count(*) from public.calendar_feed where household_id = v_hid) = 1,
    'create_calendar_feed_token should replace, not add — exactly one row per household';
  assert (select token_hash from public.calendar_feed where household_id = v_hid)
      = encode(sha256(convert_to(current_setting('db.token2'), 'UTF8')), 'hex'),
    'only the sha256 hex of the latest returned token is stored';
end $$;
set local role authenticated;

-- ── Column privilege: token_hash is never selectable by authenticated ────────

do $$ begin
  assert not has_column_privilege('authenticated', 'public.calendar_feed', 'token_hash', 'select'),
    'authenticated must not have select on calendar_feed.token_hash';
  assert has_column_privilege('authenticated', 'public.calendar_feed', 'household_id', 'select'),
    'authenticated should have select on calendar_feed.household_id';
  assert has_column_privilege('authenticated', 'public.calendar_feed', 'created_at', 'select'),
    'authenticated should have select on calendar_feed.created_at';
end $$;

do $$ begin
  perform token_hash from public.calendar_feed where household_id = current_setting('db.hid')::uuid;
  raise exception 'FAIL: authenticated selected calendar_feed.token_hash';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated blocked from selecting token_hash';
end $$;

-- ── No direct write path: every mutation goes through the RPCs ──────────────

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  begin
    insert into public.calendar_feed (household_id, token_hash) values (v_hid, 'deadbeef');
    raise exception 'FAIL: authenticated inserted a calendar_feed row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from inserting calendar_feed directly';
  end;

  begin
    update public.calendar_feed set token_hash = 'hijacked' where household_id = v_hid;
    raise exception 'FAIL: authenticated updated a calendar_feed row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from updating calendar_feed directly';
  end;

  begin
    delete from public.calendar_feed where household_id = v_hid;
    raise exception 'FAIL: authenticated deleted a calendar_feed row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from deleting calendar_feed directly';
  end;
end $$;

-- ── Cross-household isolation ────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"cal-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as db_hid2 \gset
select set_config('db.hid2', :'db_hid2', false);

do $$ begin
  assert (select count(*) from public.calendar_feed) = 0,
    'Bob should not see Alice''s calendar feed via RLS';
end $$;

select public.revoke_calendar_feed_token();
do $$ begin
  assert (select count(*) from public.calendar_feed where household_id = current_setting('db.hid2')::uuid) = 0,
    'revoke_calendar_feed_token should be a no-op when the household has no feed';
end $$;

-- ── Revoke deletes the row ────────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"cal-alice@example.com"}', true);
select public.revoke_calendar_feed_token();
do $$ begin
  assert (select count(*) from public.calendar_feed where household_id = current_setting('db.hid')::uuid) = 0,
    'revoke_calendar_feed_token should delete the household''s feed';
end $$;

rollback;
