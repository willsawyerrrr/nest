-- RLS isolation assertions for the wishlist table.
--
-- `wishlist_item` carries the same household-wide policy as `temporary_item` and
-- the other planning tables: a member reads and writes only their own
-- household's rows, a co-member in the same household sees them, and another
-- household is fully isolated. `member_id` is a display tag, not a privacy
-- boundary — both members of a household see every wishlist row regardless of
-- whose wish it is.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'wish-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'wish-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'wish-carol@example.com');

-- ── Alice's household ────────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"wish-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as hid \gset
select set_config('wish.hid', :'hid', false);
select id as mid from public.members where household_id = current_setting('wish.hid')::uuid \gset
select set_config('wish.mid', :'mid', false);

-- Alice records two wishes — one tagged to her member, one untagged.
insert into public.wishlist_item (household_id, name, amount_cents, member_id, note)
  values (current_setting('wish.hid')::uuid, 'Espresso machine', 1_200_00, current_setting('wish.mid')::uuid, 'The dual-boiler one');
insert into public.wishlist_item (household_id, name, amount_cents)
  values (current_setting('wish.hid')::uuid, 'New couch', 3_500_00);

do $$ begin
  assert (select count(*) from public.wishlist_item) = 2, 'Alice should see both her wishlist items';
  assert (select amount_cents from public.wishlist_item where name = 'Espresso machine') = 1_200_00,
    'the wishlist amount should round-trip';
  assert (select member_id from public.wishlist_item where name = 'New couch') is null,
    'a wishlist item needs no member tag';
end $$;

-- The amount must be positive.
do $$ begin
  insert into public.wishlist_item (household_id, name, amount_cents)
    values (current_setting('wish.hid')::uuid, 'Free stuff', 0);
  raise exception 'FAIL: a non-positive wishlist amount was accepted';
exception when check_violation then
  raise notice 'PASS: a wishlist amount must be positive';
end $$;

-- set_updated_at stamps the update over whatever the client supplies.
do $$ begin
  update public.wishlist_item set amount_cents = 1_300_00, updated_at = '2000-01-01'
    where name = 'Espresso machine';
  assert (select updated_at from public.wishlist_item where name = 'Espresso machine') = now(),
    'set_updated_at should stamp the update, overriding a client-supplied updated_at';
end $$;

-- ── Bob's separate household is isolated ─────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"wish-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as hid2 \gset
select set_config('wish.hid2', :'hid2', false);

do $$ begin
  assert (select count(*) from public.wishlist_item) = 0, 'Bob must not see Alice''s wishlist items';
end $$;

-- Bob cannot write into Alice's household (RLS WITH CHECK).
do $$ begin
  insert into public.wishlist_item (household_id, name, amount_cents)
    values (current_setting('wish.hid')::uuid, 'Sneaky', 1_00);
  raise exception 'FAIL: Bob inserted a wishlist item into Alice''s household';
exception when insufficient_privilege then
  raise notice 'PASS: Bob blocked from inserting into Alice''s household';
end $$;

-- ── Carol joins Alice's household and sees every wishlist row ────────────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"wish-alice@example.com"}', true);
select invite_code as code from public.create_invite_code() \gset
select set_config('wish.code', :'code', false);

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000003","email":"wish-carol@example.com"}', true);
select public.join_household(current_setting('wish.code'), 'Carol');

do $$ begin
  assert (select count(*) from public.wishlist_item) = 2,
    'Carol should see both of Alice''s wishlist items after joining';
  assert (select count(*) from public.wishlist_item
    where member_id = current_setting('wish.mid')::uuid) = 1,
    'Carol should see Alice''s member-tagged wish — the tag is not a privacy boundary';
end $$;

-- Carol can add and edit wishlist rows in the shared household.
insert into public.wishlist_item (household_id, name, amount_cents)
  values (current_setting('wish.hid')::uuid, 'Weekend away', 800_00);
update public.wishlist_item set note = 'Somewhere with a beach' where name = 'Weekend away';

do $$ begin
  assert (select count(*) from public.wishlist_item) = 3, 'Carol should see her own added wish alongside Alice''s';
  assert (select note from public.wishlist_item where name = 'Weekend away') = 'Somewhere with a beach',
    'Carol should be able to edit a shared wishlist item';
end $$;

rollback;
