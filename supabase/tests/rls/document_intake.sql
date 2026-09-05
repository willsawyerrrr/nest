-- Assertions for document-intake's two tables: `document_intake_token` (the
-- bearer credential a member's Shortcut carries) and `document_intake` (the
-- staged upload it lands as).
--
-- `create_document_intake_token` / `revoke_document_intake_token` are both
-- SECURITY DEFINER and operate on the CALLER'S OWN member only — unlike
-- `share_grant`, there is no household-wide mint. `token_hash` must never be
-- selectable by `authenticated`. `document_intake` accepts no direct insert
-- from `authenticated` at all: only `service_role` (document-intake's
-- service-role client) writes it, so this suite seeds staging rows with `set
-- local role service_role` before switching back to exercise the
-- household's own read/delete boundary.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'intake-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'intake-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'intake-carol@example.com');

-- ── Alice + Bob's household ──────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"intake-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as db_hid \gset
select set_config('db.hid', :'db_hid', false);

select id as db_alice_id from public.members
  where household_id = current_setting('db.hid')::uuid and user_id = '60000000-0000-0000-0000-000000000001' \gset
select set_config('db.alice_id', :'db_alice_id', false);

select invite_code as db_code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"intake-bob@example.com"}', true);
select public.join_household(:'db_code', 'Bob');

select id as db_bob_id from public.members
  where household_id = current_setting('db.hid')::uuid and user_id = '60000000-0000-0000-0000-000000000002' \gset
select set_config('db.bob_id', :'db_bob_id', false);

-- ── document_intake_token: mint, replace, and household-wide status read ────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"intake-alice@example.com"}', true);

-- No token exists yet.
do $$ begin
  assert (select count(*) from public.document_intake_token where household_id = current_setting('db.hid')::uuid) = 0,
    'a fresh household should have no document intake token';
end $$;

select token as db_token1, created_at as db_created1
  from public.create_document_intake_token() \gset
select set_config('db.token1', :'db_token1', false);

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
declare v_alice uuid := current_setting('db.alice_id')::uuid;
begin
  assert length(current_setting('db.token1')) = 64,
    'the returned token should be 64 hex characters';
  assert (select count(*) from public.document_intake_token where household_id = v_hid) = 1,
    'create_document_intake_token should insert exactly one row';
  assert (select member_id from public.document_intake_token where household_id = v_hid) = v_alice,
    'the token should be minted for the calling member, not the household at large';
end $$;

-- A second call replaces Alice's own row rather than adding a second one, and
-- mints a different token.
select token as db_token2 from public.create_document_intake_token() \gset
select set_config('db.token2', :'db_token2', false);
do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert (select count(*) from public.document_intake_token where household_id = v_hid) = 1,
    'a second call for the same member should still leave exactly one row';
  assert current_setting('db.token1') <> current_setting('db.token2'),
    'each call should mint a fresh token';
end $$;

-- ── Column privilege: token_hash is never selectable by authenticated ────────

do $$ begin
  assert not has_column_privilege('authenticated', 'public.document_intake_token', 'token_hash', 'select'),
    'authenticated must not have select on document_intake_token.token_hash';
  assert has_column_privilege('authenticated', 'public.document_intake_token', 'created_at', 'select'),
    'authenticated should have select on document_intake_token.created_at';
end $$;

do $$ begin
  perform token_hash from public.document_intake_token where household_id = current_setting('db.hid')::uuid;
  raise exception 'FAIL: authenticated selected document_intake_token.token_hash';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated blocked from selecting token_hash';
end $$;

-- ── Household-wide read of token status, including a co-member's ────────────
-- Bob did not mint a token, but he can see that Alice's is active — the same
-- transparency members.up_connected_at gives for the Up connection.

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"intake-bob@example.com"}', true);
do $$ begin
  assert (select count(*) from public.document_intake_token where household_id = current_setting('db.hid')::uuid) = 1,
    'Bob should see that a token exists in his household, though he did not mint it';
end $$;

-- Bob mints his own; the household now has two live tokens.
select public.create_document_intake_token();
do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
declare v_bob uuid := current_setting('db.bob_id')::uuid;
begin
  assert (select count(*) from public.document_intake_token where household_id = v_hid) = 2,
    'Bob minting his own token should not disturb Alice''s';
  assert (select count(*) from public.document_intake_token where member_id = v_bob) = 1,
    'Bob''s token should be recorded under his own member id';
end $$;

-- ── No direct write path: every mutation goes through the RPCs ──────────────

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  begin
    insert into public.document_intake_token (member_id, household_id, token_hash)
      values (gen_random_uuid(), v_hid, 'deadbeef');
    raise exception 'FAIL: authenticated inserted a document_intake_token row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from inserting document_intake_token directly';
  end;

  begin
    update public.document_intake_token set token_hash = 'hijacked' where household_id = v_hid;
    raise exception 'FAIL: authenticated updated a document_intake_token row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from updating document_intake_token directly';
  end;

  begin
    delete from public.document_intake_token where household_id = v_hid;
    raise exception 'FAIL: authenticated deleted a document_intake_token row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from deleting document_intake_token directly';
  end;
end $$;

-- ── Revoke deletes only the caller's own row ─────────────────────────────────
-- Bob is still the caller here; revoking must remove his row and leave Alice's.

select public.revoke_document_intake_token();
do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
declare v_alice uuid := current_setting('db.alice_id')::uuid;
declare v_bob uuid := current_setting('db.bob_id')::uuid;
begin
  assert (select count(*) from public.document_intake_token where member_id = v_bob) = 0,
    'revoke_document_intake_token should delete the caller''s own row';
  assert (select count(*) from public.document_intake_token where member_id = v_alice) = 1,
    'revoke_document_intake_token should never touch another member''s row';
end $$;

-- A second revoke is a no-op rather than an error.
select public.revoke_document_intake_token();
do $$ begin
  assert (select count(*) from public.document_intake_token where household_id = current_setting('db.hid')::uuid) = 1,
    'revoking twice should be a no-op the second time';
end $$;

-- ── document_intake: only service_role inserts ───────────────────────────────

set local role service_role;
insert into public.document_intake (id, household_id, member_id, kind, storage_path, original_filename)
  values (
    '70000000-0000-0000-0000-000000000001',
    current_setting('db.hid')::uuid,
    current_setting('db.alice_id')::uuid,
    'payslip',
    current_setting('db.hid') || '/70000000-0000-0000-0000-000000000001/slip.pdf',
    'slip.pdf'
  );
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"intake-alice@example.com"}', true);
do $$ begin
  assert (select count(*) from public.document_intake where household_id = current_setting('db.hid')::uuid) = 1,
    'the household should see the staged document a service-role upload inserted';
end $$;

-- Bob can see and dismiss it too — household-wide, exactly as payslip/deduction.
select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"intake-bob@example.com"}', true);
do $$ begin
  assert (select count(*) from public.document_intake where household_id = current_setting('db.hid')::uuid) = 1,
    'a co-member should see the staged document too -- household-wide, not member-private';
end $$;

do $$ begin
  begin
    insert into public.document_intake (id, household_id, member_id, kind, storage_path)
      values (gen_random_uuid(), current_setting('db.hid')::uuid, current_setting('db.bob_id')::uuid, 'deduction', 'x/y/z.pdf');
    raise exception 'FAIL: authenticated inserted a document_intake row directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated blocked from inserting document_intake directly';
  end;
end $$;

delete from public.document_intake where id = '70000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.document_intake where household_id = current_setting('db.hid')::uuid) = 0,
    'a household member should be able to dismiss (delete) a staged document';
end $$;

-- ── Cross-household isolation ────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000003","email":"intake-carol@example.com"}', true);
select public.create_household('Carol Household', 'Carol') as db_hid2 \gset
select set_config('db.hid2', :'db_hid2', false);

do $$ begin
  assert (select count(*) from public.document_intake_token where household_id = current_setting('db.hid')::uuid) = 0,
    'Carol should not see Alice/Bob''s household tokens via RLS';
end $$;

select public.create_document_intake_token();
do $$ begin
  assert (select count(*) from public.document_intake_token) = 1,
    'the visible token row count under RLS should be scoped to Carol''s own household';
end $$;

set local role service_role;
insert into public.document_intake (id, household_id, member_id, kind, storage_path)
  values (
    '70000000-0000-0000-0000-000000000002',
    current_setting('db.hid')::uuid,
    current_setting('db.alice_id')::uuid,
    'deduction',
    current_setting('db.hid') || '/70000000-0000-0000-0000-000000000002/receipt.pdf'
  );
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000003","email":"intake-carol@example.com"}', true);
do $$ begin
  assert (select count(*) from public.document_intake) = 0,
    'Carol should not see Alice/Bob''s staged document via RLS';
end $$;

rollback;
