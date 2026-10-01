-- The automatic "Donations" group holds donations and nothing else.
--
-- `file_donation_in_default_group` files an unfiled donation into the member's
-- "Donations" `deduction_group` for its financial year. That group is a kind of
-- group in its own right rather than a group that happens to be called
-- "Donations": `deduction_group.kind` is `standard` for a group the member
-- creates and `donations` for the automatic one, so the trigger finds it by
-- kind and a member's own group named "Donations" is an ordinary group.
--
-- Donations and the donations group belong together in both directions:
--
-- * only a `donation` can sit in a `donations` group, and
-- * a `donation` can sit in no group but a `donations` one.
--
-- The group itself is fixed: its name and kind cannot change, and it cannot be
-- deleted (a household, member, or financial year being deleted still takes it
-- with them, since the foreign keys cascade outside row-level security).
--
-- Every statement is re-runnable, so a half-applied migration retried from the
-- top still lands (see the note in 20260828000000_deduction_work_use.sql).

alter table public.deduction_group
  add column if not exists kind text not null default 'standard';

alter table public.deduction_group
  drop constraint if exists deduction_group_kind_check,
  add constraint deduction_group_kind_check check (kind in ('standard', 'donations'));

comment on column public.deduction_group.kind is '`standard` for a group the member names and fills, `donations` for the automatic group holding the member''s donations for the year. A `donations` group holds only donations, and cannot be renamed, re-kinded, or deleted.';

-- ── Existing data ────────────────────────────────────────────────────────────
--
-- Runs outside RLS as the migration, before the new triggers exist (a retried
-- run drops the one that would refuse the flagging).

drop trigger if exists protect_donations_group on public.deduction_group;

-- Flag the existing automatic group of each member and year. Where a scope has
-- more than one group named "Donations", the one holding the most donations
-- (then the oldest) is the automatic one and the rest stay standard.
update public.deduction_group g
set kind = 'donations'
from (
  select distinct on (dg.household_id, dg.member_id, dg.financial_year) dg.id
  from public.deduction_group dg
  where dg.name = 'Donations'
    and not exists (
      select 1 from public.deduction_group k
      where k.household_id = dg.household_id
        and k.member_id = dg.member_id
        and k.financial_year = dg.financial_year
        and k.kind = 'donations'
    )
  order by dg.household_id, dg.member_id, dg.financial_year,
    (select count(*) from public.deduction d where d.group_id = dg.id and d.category = 'donation') desc,
    dg.created_at, dg.id
) picked
where g.id = picked.id;

-- At most one donations group per member and year; the trigger relies on it.
create unique index if not exists deduction_group_one_donations_per_year
  on public.deduction_group (household_id, member_id, financial_year)
  where kind = 'donations';

-- Every scope with a donation but no donations group gets one.
insert into public.deduction_group (household_id, member_id, financial_year, name, kind)
select distinct d.household_id, d.member_id, d.financial_year, 'Donations', 'donations'
from public.deduction d
where d.category = 'donation'
on conflict do nothing;

-- Donations outside the donations group move into it.
update public.deduction d
set group_id = g.id
from public.deduction_group g
where g.kind = 'donations'
  and g.household_id = d.household_id
  and g.member_id = d.member_id
  and g.financial_year = d.financial_year
  and d.category = 'donation'
  and d.group_id is distinct from g.id;

-- Anything else in a donations group steps out of it.
update public.deduction d
set group_id = null
from public.deduction_group g
where g.id = d.group_id
  and g.kind = 'donations'
  and d.category <> 'donation';

-- ── Donations and the donations group ────────────────────────────────────────

create or replace function public.file_donation_in_default_group()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_kind text;
begin
  if new.category = 'donation' then
    if new.group_id is null then
      select id into v_group_id
      from public.deduction_group
      where household_id = new.household_id
        and member_id = new.member_id
        and financial_year = new.financial_year
        and kind = 'donations';

      if v_group_id is null then
        insert into public.deduction_group (household_id, member_id, financial_year, name, kind)
        values (new.household_id, new.member_id, new.financial_year, 'Donations', 'donations')
        on conflict do nothing
        returning id into v_group_id;

        if v_group_id is null then
          select id into v_group_id
          from public.deduction_group
          where household_id = new.household_id
            and member_id = new.member_id
            and financial_year = new.financial_year
            and kind = 'donations';
        end if;
      end if;

      new.group_id := v_group_id;
      return new;
    end if;
  elsif new.group_id is null then
    return new;
  end if;

  select kind into v_kind from public.deduction_group where id = new.group_id;

  if new.category = 'donation' and v_kind <> 'donations' then
    raise exception 'a donation can only sit in a donations group'
      using errcode = 'check_violation', constraint = 'deduction_donation_group_kind';
  elsif new.category <> 'donation' and v_kind = 'donations' then
    raise exception 'only a donation can sit in a donations group'
      using errcode = 'check_violation', constraint = 'deduction_donation_group_kind';
  end if;

  return new;
end;
$$;
comment on function public.file_donation_in_default_group() is 'Keeps donations and the donations group together. An unfiled donation (category = ''donation'', group_id null) is filed into the member''s `donations` deduction_group for its financial year, created the first time it is needed. A donation in any other group, or any other category in a `donations` group, is refused.';

drop trigger if exists file_donation_in_default_group on public.deduction;
create trigger file_donation_in_default_group before insert or update on public.deduction
  for each row execute function public.file_donation_in_default_group();

-- ── The donations group is fixed ─────────────────────────────────────────────

create or replace function public.protect_donations_group()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
    or (old.kind = 'donations' and new.name is distinct from old.name) then
    raise exception 'a donations group cannot be renamed or re-kinded'
      using errcode = 'check_violation', constraint = 'deduction_group_donations_fixed';
  end if;
  return new;
end;
$$;
comment on function public.protect_donations_group() is 'Refuses to change a deduction_group''s `kind`, or to rename a `donations` group.';

drop trigger if exists protect_donations_group on public.deduction_group;
create trigger protect_donations_group before update on public.deduction_group
  for each row execute function public.protect_donations_group();

-- Row-level security refuses deleting a donations group. Deletes by the
-- foreign keys' cascades run outside it, so removing a household still works.
drop policy if exists "household members manage deduction groups" on public.deduction_group;
drop policy if exists "household members read deduction groups" on public.deduction_group;
drop policy if exists "household members add deduction groups" on public.deduction_group;
drop policy if exists "household members edit deduction groups" on public.deduction_group;
drop policy if exists "household members delete standard deduction groups" on public.deduction_group;

create policy "household members read deduction groups" on public.deduction_group
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));
create policy "household members add deduction groups" on public.deduction_group
  for insert to authenticated
  with check (household_id in (select public.household_ids_for_current_user()));
create policy "household members edit deduction groups" on public.deduction_group
  for update to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));
create policy "household members delete standard deduction groups" on public.deduction_group
  for delete to authenticated
  using (
    kind = 'standard'
    and household_id in (select public.household_ids_for_current_user())
  );
