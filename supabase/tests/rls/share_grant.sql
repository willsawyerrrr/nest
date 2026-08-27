-- Assertions for the EOFY share-grant table and its RPCs.
--
-- `create_share_grant` mints (or replaces) the caller's household's single live
-- share; `revoke_share_grant` deletes it. Both are SECURITY DEFINER, so a direct
-- PostgREST write to `share_grant` must be impossible, and `token_hash` — the
-- credential itself — must never be selectable by `authenticated`, only the
-- other columns the household's own UI shows back.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'share-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'share-bob@example.com');

-- ── Alice's household ─────────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","email":"share-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as db_hid \gset
select set_config('db.hid', :'db_hid', false);

-- No share exists yet.
do $$ begin
  assert (select count(*) from public.share_grant where household_id = current_setting('db.hid')::uuid) = 0,
    'a fresh household should have no share';
end $$;

select token as db_token1, expires_at as db_expires1
  from public.create_share_grant(2027, 'agent@example.com') \gset
select set_config('db.token1', :'db_token1', false);

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert length(current_setting('db.token1')) = 64,
    'the returned token should be 64 hex characters';
  assert (select count(*) from public.share_grant where household_id = v_hid) = 1,
    'create_share_grant should insert exactly one row for the household';
  assert (select financial_year from public.share_grant where household_id = v_hid) = 2027,
    'the share should be scoped to the requested financial year';
  assert (select recipient_email from public.share_grant where household_id = v_hid) = 'agent@example.com',
    'the share should record the recipient email';
  assert (select expires_at from public.share_grant where household_id = v_hid) > now() + interval '6 days',
    'the share should expire about 7 days out';
end $$;

-- A second call replaces the row rather than adding a second one, and mints a
-- different token.
select token as db_token2, expires_at as db_expires2
  from public.create_share_grant(2026, 'other-agent@example.com') \gset
select set_config('db.token2', :'db_token2', false);

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert (select count(*) from public.share_grant where household_id = v_hid) = 1,
    'a second create_share_grant call should still leave exactly one row';
  assert (select financial_year from public.share_grant where household_id = v_hid) = 2026,
    'the second call should replace the financial year';
  assert (select recipient_email from public.share_grant where household_id = v_hid) = 'other-agent@example.com',
    'the second call should replace the recipient email';
  assert current_setting('db.token1') <> current_setting('db.token2'),
    'each call should mint a fresh token';
end $$;

-- ── Column privilege: token_hash is never selectable by authenticated ────────

do $$ begin
  assert not has_column_privilege('authenticated', 'public.share_grant', 'token_hash', 'select'),
    'authenticated must not have select on share_grant.token_hash';
  assert has_column_privilege('authenticated', 'public.share_grant', 'recipient_email', 'select'),
    'authenticated should have select on share_grant.recipient_email';
  assert has_column_privilege('authenticated', 'public.share_grant', 'expires_at', 'select'),
    'authenticated should have select on share_grant.expires_at';
end $$;

do $$ begin
  perform token_hash from public.share_grant where household_id = current_setting('db.hid')::uuid;
  raise exception 'FAIL: authenticated selected share_grant.token_hash';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated blocked from selecting token_hash';
end $$;

-- ── No direct write path: every mutation goes through the RPCs ──────────────

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  begin
    insert into public.share_grant (household_id, financial_year, token_hash, recipient_email, expires_at)
      values (v_hid, 2027, 'deadbeef', 'direct@example.com', now() + interval '7 days');
    raise exception 'FAIL: authenticated inserted a share_grant row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from inserting share_grant directly';
  end;

  begin
    update public.share_grant set recipient_email = 'hijacked@example.com' where household_id = v_hid;
    raise exception 'FAIL: authenticated updated a share_grant row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from updating share_grant directly';
  end;

  begin
    delete from public.share_grant where household_id = v_hid;
    raise exception 'FAIL: authenticated deleted a share_grant row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from deleting share_grant directly';
  end;
end $$;

-- ── Cross-household isolation ────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000002","email":"share-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as db_hid2 \gset
select set_config('db.hid2', :'db_hid2', false);

do $$ begin
  assert (select count(*) from public.share_grant where household_id = current_setting('db.hid')::uuid) = 0,
    'Bob should not see Alice''s share via RLS';
end $$;

-- Bob's own household has no share until he creates one.
do $$ begin
  assert (select count(*) from public.share_grant) = 0,
    'the visible row count under RLS should be scoped to the current household (none for Bob)';
end $$;

select public.revoke_share_grant();
do $$ begin
  assert (select count(*) from public.share_grant where household_id = current_setting('db.hid2')::uuid) = 0,
    'revoke_share_grant should be a no-op when the household has no share';
end $$;

-- ── Revoke deletes the row ────────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","email":"share-alice@example.com"}', true);
select public.revoke_share_grant();
do $$ begin
  assert (select count(*) from public.share_grant where household_id = current_setting('db.hid')::uuid) = 0,
    'revoke_share_grant should delete the household''s share';
end $$;

rollback;
