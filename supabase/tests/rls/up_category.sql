-- Assertions for `up_category` and its two write paths: sync_up_categories
-- (up-sync's taxonomy refresh) and set_up_transaction_category (up-categorise's
-- record of a written-back category).
--
-- `authenticated` reads the taxonomy and writes neither it nor through either
-- function; both functions are SECURITY DEFINER and granted to service_role
-- alone, which holds no table write grant of its own. The refresh upserts
-- parents before children whatever order Up lists them in. The record sets an
-- Up row's category and its parent, restamps `external_category_since` only on
-- a change, and leaves a manual row alone.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'up-cat-alice@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"63000000-0000-0000-0000-000000000001","email":"up-cat-alice@example.com"}', true);
select public.create_household('Up Category Household', 'Alice') as hid \gset
select id as mid from public.members where household_id = :'hid' \gset
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'hid', :'mid', 'Alice''s Spending', 'transaction', 'up', 'up-cat-acc');
select id as aid from public.accounts where external_id = 'up-cat-acc' \gset
reset role;

insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, source, external_id,
   external_category, external_parent_category, external_category_since)
  values
  (:'hid', :'aid', now(), -40_00, 'Florist', 'expense', 'up', 'up-cat-tx',
   'clothing-and-accessories', 'personal', '2026-01-01T00:00:00Z'),
  (:'hid', :'aid', now(), -10_00, 'Cash', 'expense', 'manual', null, null, null, '2026-01-01T00:00:00Z');
select id as up_tx from public.transactions where external_id = 'up-cat-tx' \gset
select id as manual_tx from public.transactions where description = 'Cash' and household_id = :'hid' \gset
select set_config('test.up_tx', :'up_tx', false);
select set_config('test.manual_tx', :'manual_tx', false);

-- ── service_role refreshes the taxonomy, children listed first ─────────────────

set local role service_role;
select public.sync_up_categories(jsonb_build_array(
  jsonb_build_object('id', 'gifts-and-charity', 'name', 'Gifts & Charity', 'parent_id', 'personal'),
  jsonb_build_object('id', 'clothing-and-accessories', 'name', 'Clothing', 'parent_id', 'personal'),
  jsonb_build_object('id', 'personal', 'name', 'Personal', 'parent_id', null)
));
-- A second run renames in place.
select public.sync_up_categories(jsonb_build_array(
  jsonb_build_object('id', 'personal', 'name', 'Personal', 'parent_id', null),
  jsonb_build_object('id', 'clothing-and-accessories', 'name', 'Clothing & Accessories', 'parent_id', 'personal')
));
do $$
begin
  begin
    insert into public.up_category (id, name) values ('nope', 'Nope');
    raise exception 'service_role should not insert into up_category directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.up_category) <> 3 then
    raise exception 'expected 3 categories, got %', (select count(*) from public.up_category);
  end if;
  if (select name from public.up_category where id = 'clothing-and-accessories') <> 'Clothing & Accessories' then
    raise exception 'a refresh should rename a category in place';
  end if;
  if (select parent_id from public.up_category where id = 'gifts-and-charity') <> 'personal' then
    raise exception 'a child should keep its parent';
  end if;
end;
$$;

-- ── authenticated reads the taxonomy and writes nothing ───────────────────────

set local role authenticated;
do $$
begin
  if (select count(*) from public.up_category) <> 3 then
    raise exception 'authenticated should read every category';
  end if;
  begin
    insert into public.up_category (id, name) values ('nope', 'Nope');
    raise exception 'authenticated should not insert into up_category';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sync_up_categories('[]'::jsonb);
    raise exception 'authenticated should not execute sync_up_categories';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_up_transaction_category(current_setting('test.up_tx')::uuid, null);
    raise exception 'authenticated should not execute set_up_transaction_category';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── service_role records a written-back category ──────────────────────────────

set local role service_role;
do $$
begin
  if not public.set_up_transaction_category(current_setting('test.up_tx')::uuid, 'gifts-and-charity') then
    raise exception 'recording on an Up row should report true';
  end if;
end;
$$;
reset role;

do $$
declare
  t record;
begin
  select external_category, external_parent_category, external_category_since into t
    from public.transactions where id = current_setting('test.up_tx')::uuid;
  if t.external_category <> 'gifts-and-charity' or t.external_parent_category <> 'personal' then
    raise exception 'category not recorded: % / %', t.external_category, t.external_parent_category;
  end if;
  if t.external_category_since = '2026-01-01T00:00:00Z' then
    raise exception 'a changed category should restamp external_category_since';
  end if;
  update public.transactions set external_category_since = '2026-02-01T00:00:00Z'
    where id = current_setting('test.up_tx')::uuid;
end;
$$;

set local role service_role;
select public.set_up_transaction_category(current_setting('test.up_tx')::uuid, 'gifts-and-charity');
reset role;

do $$
begin
  if (select external_category_since from public.transactions
      where id = current_setting('test.up_tx')::uuid) <> '2026-02-01T00:00:00Z' then
    raise exception 'an unchanged category should keep external_category_since';
  end if;
end;
$$;

set local role service_role;
select public.set_up_transaction_category(current_setting('test.up_tx')::uuid, null);
do $$
begin
  if public.set_up_transaction_category(current_setting('test.manual_tx')::uuid, 'gifts-and-charity') then
    raise exception 'recording on a manual row should report false';
  end if;
end;
$$;
reset role;

do $$
begin
  if (select external_category is not null or external_parent_category is not null
      from public.transactions where id = current_setting('test.up_tx')::uuid) then
    raise exception 'null should clear the category and its parent';
  end if;
  if (select external_category from public.transactions
      where id = current_setting('test.manual_tx')::uuid) is not null then
    raise exception 'a manual row should be left alone';
  end if;
end;
$$;

rollback;
