-- A member's donations are grouped automatically.
--
-- A household gives to several charities across a year, and totalling those
-- receipts to check a tax return is exactly what a deduction group is for.
-- Rather than asking the member to create a "Donations" group and file each
-- gift into it, a `donation` deduction with no group of its own is filed into
-- the member's "Donations" group for its financial year, that group being
-- created the first time it is needed.
--
-- This is the same "grouping is a reading of rows that already exist" model
-- deduction groups have always had: the group carries a name and totals its
-- payments, and every deduction underneath is still claimed in its own right,
-- so the tax estimate, the EOFY tab, and the Summary need no change.
--
-- The member keeps full control: creating other named donation groups (one per
-- charity, say) and moving a donation between them both still work — the
-- trigger only acts when `group_id` is null, so an explicit choice is left
-- alone. Clearing a donation's group snaps it back to "Donations", because a
-- donation is always in a group.
--
-- Tax agent fees are untouched: a household has at most one a year, so there is
-- nothing to total.
--
-- `create or replace function` / `drop trigger if exists … create trigger` so a
-- half-applied migration retried from the top still lands (see the note in
-- 20260828000000_deduction_work_use.sql).

create or replace function public.file_donation_in_default_group()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  -- Only an unfiled donation: a work expense or tax agent fee is never
  -- auto-grouped, and a donation the member filed somewhere keeps that group.
  if new.category <> 'donation' or new.group_id is not null then
    return new;
  end if;

  select id into v_group_id
  from public.deduction_group
  where household_id = new.household_id
    and member_id = new.member_id
    and financial_year = new.financial_year
    and name = 'Donations'
  limit 1;

  if v_group_id is null then
    insert into public.deduction_group (household_id, member_id, financial_year, name)
    values (new.household_id, new.member_id, new.financial_year, 'Donations')
    returning id into v_group_id;
  end if;

  new.group_id := v_group_id;
  return new;
end;
$$;
comment on function public.file_donation_in_default_group() is 'Files an unfiled donation (category = ''donation'', group_id null) into the member''s "Donations" deduction_group for its financial year, creating that group the first time it is needed. A donation the member filed elsewhere, and every non-donation deduction, is left alone.';

drop trigger if exists file_donation_in_default_group on public.deduction;
create trigger file_donation_in_default_group before insert or update on public.deduction
  for each row execute function public.file_donation_in_default_group();

-- Backfill: every financial year that already has standalone donations gets its
-- "Donations" group (unless one is somehow there already) and those donations
-- move into it. Runs outside RLS as the migration.
insert into public.deduction_group (household_id, member_id, financial_year, name)
select distinct d.household_id, d.member_id, d.financial_year, 'Donations'
from public.deduction d
where d.category = 'donation'
  and d.group_id is null
  and not exists (
    select 1
    from public.deduction_group g
    where g.household_id = d.household_id
      and g.member_id = d.member_id
      and g.financial_year = d.financial_year
      and g.name = 'Donations'
  );

update public.deduction d
set group_id = g.id
from public.deduction_group g
where g.name = 'Donations'
  and g.household_id = d.household_id
  and g.member_id = d.member_id
  and g.financial_year = d.financial_year
  and d.category = 'donation'
  and d.group_id is null;
