-- Assertions that any member edits a co-member's tax inputs.
--
-- `tax_profile` and `help_debt` are household-wide CRUD, so a member upserts a
-- co-member's rows and a household stranger touches none. `members.date_of_birth`
-- is written only through `set_member_date_of_birth`, which reaches any member of
-- the caller's household and no other, and never lets `name` or `email` change.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'htp-ada@example.com'),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'htp-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'htp-eve@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","email":"htp-ada@example.com"}', true);
select public.create_household('Ada Household', 'Ada') as hid \gset
select set_config('htp.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid' \gset
select set_config('htp.amid', :'amid', false);
select invite_code as code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000002","email":"htp-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');
select id as bmid from public.members where user_id = '91000000-0000-0000-0000-000000000002' \gset
select set_config('htp.bmid', :'bmid', false);

-- Bob writes Ada's tax profile and HELP debt, and her date of birth.
insert into public.tax_profile (household_id, member_id, financial_year, residency, has_private_hospital_cover)
  values (current_setting('htp.hid')::uuid, current_setting('htp.amid')::uuid, 2027, 'foreign_resident', true);
insert into public.help_debt (household_id, member_id, balance_cents)
  values (current_setting('htp.hid')::uuid, current_setting('htp.amid')::uuid, 12_000_00);
select public.set_member_date_of_birth(current_setting('htp.amid')::uuid, date '1990-05-06');

-- Ada sees and updates what Bob wrote.
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","email":"htp-ada@example.com"}', true);

do $$ begin
  assert (select residency from public.tax_profile where member_id = current_setting('htp.amid')::uuid) = 'foreign_resident',
    'a member reads the tax profile a co-member wrote for them';
  assert (select balance_cents from public.help_debt where member_id = current_setting('htp.amid')::uuid) = 12_000_00,
    'a member reads the HELP debt a co-member wrote for them';
  assert (select date_of_birth from public.members where id = current_setting('htp.amid')::uuid) = date '1990-05-06',
    'a member reads the date of birth a co-member wrote for them';
end $$;

update public.tax_profile set residency = 'resident'
  where member_id = current_setting('htp.amid')::uuid;
select public.set_member_date_of_birth(current_setting('htp.bmid')::uuid, date '1985-01-02');
select public.set_member_date_of_birth(current_setting('htp.bmid')::uuid, null);

do $$ begin
  assert (select residency from public.tax_profile where member_id = current_setting('htp.amid')::uuid) = 'resident',
    'a member updates their own tax profile';
  assert (select date_of_birth from public.members where id = current_setting('htp.bmid')::uuid) is null,
    'a null clears a co-member''s date of birth';
end $$;

-- The function reaches the date of birth only: names and emails stay own-row.
update public.members set name = 'Renamed' where id = current_setting('htp.bmid')::uuid;

do $$ begin
  assert (select name from public.members where id = current_setting('htp.bmid')::uuid) = 'Bob',
    'a member cannot rename a co-member';
end $$;

do $$
begin
  begin
    update public.members set date_of_birth = date '2000-01-01' where id = current_setting('htp.amid')::uuid;
    raise exception 'FAIL: date of birth was written directly';
  exception when insufficient_privilege then
    raise notice 'PASS: date of birth has no direct write grant';
  end;
end $$;

-- A stranger from another household reads and writes none of it.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000003","email":"htp-eve@example.com"}', true);
select public.create_household('Eve Household', 'Eve') as ehid \gset
select set_config('htp.ehid', :'ehid', false);

do $$ begin
  assert (select count(*) from public.tax_profile) = 0, 'another household sees no tax profiles';
  assert (select count(*) from public.help_debt) = 0, 'another household sees no HELP debts';
  assert (select count(*) from public.members where date_of_birth is not null) = 0,
    'another household sees no dates of birth';
end $$;

do $$
begin
  begin
    insert into public.tax_profile (household_id, member_id, financial_year)
      values (current_setting('htp.hid')::uuid, current_setting('htp.amid')::uuid, 2028);
    raise exception 'FAIL: a stranger wrote a tax profile into another household';
  exception when insufficient_privilege then
    raise notice 'PASS: a stranger cannot write another household''s tax profile';
  end;
end $$;

do $$
begin
  begin
    insert into public.tax_profile (household_id, member_id, financial_year)
      values (current_setting('htp.ehid')::uuid, current_setting('htp.amid')::uuid, 2028);
    raise exception 'FAIL: a tax profile named another household''s member';
  exception when foreign_key_violation then
    raise notice 'PASS: a tax profile''s member must belong to its household';
  end;
end $$;

do $$
begin
  begin
    perform public.set_member_date_of_birth(current_setting('htp.amid')::uuid, date '2001-01-01');
    raise exception 'FAIL: a stranger set another household member''s date of birth';
  exception when others then
    if sqlerrm = 'member not found in the caller''s household' then
      raise notice 'PASS: a stranger cannot set another household''s date of birth';
    else raise; end if;
  end;
end $$;

rollback;
