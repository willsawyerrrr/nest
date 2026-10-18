-- A member's allowance can never be overdrawn.
--
-- Saving a budget line drawn from an allowance (`allowance_member_id` set), or
-- lowering an allowance (amount, frequency, or interval), is refused when the
-- annualised total drawn from the allowance would exceed the allowance's own
-- annual amount. Annual cents are computed by `reconcile_annual_cents`, the same
-- normalisation the plan package applies, so every cadence compares like for
-- like. A zero allowance admits nothing but zero-amount lines.
--
-- Both guards are SECURITY DEFINER: the drawn lines are private to their member,
-- yet a co-member lowering an allowance must still be held to them. The refusal
-- is a fixed `allowance_overdrawn` check violation that names no amount, so it
-- discloses nothing of the private lines beyond the refusal itself. The guards
-- lock the allowance row, serialising concurrent draws and edits.

-- ── Existing overdrawn allowances ────────────────────────────────────────────
--
-- Before the guards exist, raise each allowance already drawn beyond its amount
-- to exactly cover its drawn lines, keeping its cadence. The household's
-- Discretionary outgoing was already the larger of the two, so no figure in the
-- plan, the buffer, or the pay splits moves, and no line is released (which would
-- make a private item visible to the household) or edited.

update public.member_allowance a set
  amount_cents = case
    when a.frequency = 'every_n_weeks'
      then ceil(d.annual::numeric * a.interval_count / 52)::bigint
    when a.frequency = 'every_n_months'
      then ceil(d.annual::numeric * a.interval_count / 12)::bigint
    else ceil(d.annual::numeric / case a.frequency
      when 'weekly' then 52
      when 'fortnightly' then 26
      when 'monthly' then 12
      when 'quarterly' then 4
      when 'biannual' then 2
      else 1
    end)::bigint
  end
from (
  select
    b.allowance_member_id as member_id,
    b.household_id,
    sum(public.reconcile_annual_cents(b.amount_cents, b.frequency, b.interval_count)) as annual
  from public.budget_line b
  where b.allowance_member_id is not null
  group by b.allowance_member_id, b.household_id
) d
where d.member_id = a.member_id
  and d.household_id = a.household_id
  and d.annual > public.reconcile_annual_cents(a.amount_cents, a.frequency, a.interval_count);

-- ── Guard: drawing a line ────────────────────────────────────────────────────
--
-- Runs when a line is drawn, repointed, or its amount or cadence changes. A
-- change that keeps the line on the same allowance without raising its annual
-- amount is always allowed, so a line can be trimmed toward the allowance.

create function public.prevent_allowance_overdraw_by_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowance bigint;
  v_drawn bigint;
  v_annual bigint :=
    public.reconcile_annual_cents(new.amount_cents, new.frequency, new.interval_count);
begin
  if tg_op = 'UPDATE'
     and old.allowance_member_id is not distinct from new.allowance_member_id
     and v_annual <= public.reconcile_annual_cents(old.amount_cents, old.frequency, old.interval_count) then
    return new;
  end if;

  select public.reconcile_annual_cents(a.amount_cents, a.frequency, a.interval_count)
    into v_allowance
    from public.member_allowance a
    where a.member_id = new.allowance_member_id and a.household_id = new.household_id
    for update;
  if not found then
    return new;
  end if;

  select coalesce(sum(public.reconcile_annual_cents(b.amount_cents, b.frequency, b.interval_count)), 0)
    into v_drawn
    from public.budget_line b
    where b.allowance_member_id = new.allowance_member_id
      and b.household_id = new.household_id
      and b.id <> new.id;

  if v_drawn + v_annual > coalesce(v_allowance, 0) then
    raise exception 'allowance_overdrawn' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.prevent_allowance_overdraw_by_line() is 'Rejects drawing a budget line from an allowance when the annualised drawn total would exceed the allowance.';

create trigger prevent_allowance_overdraw
  before insert or update of amount_cents, frequency, interval_count, allowance_member_id
  on public.budget_line
  for each row
  when (new.allowance_member_id is not null)
  execute function public.prevent_allowance_overdraw_by_line();

-- ── Guard: lowering an allowance ─────────────────────────────────────────────

create function public.prevent_allowance_overdraw_by_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drawn bigint;
begin
  select coalesce(sum(public.reconcile_annual_cents(b.amount_cents, b.frequency, b.interval_count)), 0)
    into v_drawn
    from public.budget_line b
    where b.allowance_member_id = new.member_id and b.household_id = new.household_id;

  if v_drawn > public.reconcile_annual_cents(new.amount_cents, new.frequency, new.interval_count) then
    raise exception 'allowance_overdrawn' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.prevent_allowance_overdraw_by_allowance() is 'Rejects lowering an allowance below the annualised total already drawn from it.';

create trigger prevent_allowance_overdraw
  before update of amount_cents, frequency, interval_count on public.member_allowance
  for each row
  execute function public.prevent_allowance_overdraw_by_allowance();

-- ── Drawn totals are not shared with co-members ────────────────────────
--
-- An allowance counts at its own amount and is never exceeded, so a co-member
-- needs nothing of what is drawn from it.

drop function public.hidden_allowance_drawn();

comment on column public.budget_line.allowance_member_id is 'The member whose allowance this line is drawn from; only a manual Discretionary line with no destination of its own may set it. The line counts against the allowance rather than on top of it, and the annualised total drawn can never exceed the allowance. It routes with the allowance, and is readable and writable only by that member.';
