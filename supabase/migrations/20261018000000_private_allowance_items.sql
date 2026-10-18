-- Budget lines drawn from a member's allowance are private to that member.
--
-- A line with `allowance_member_id` set is readable and writable only by the
-- member it is drawn from; every other household member sees the allowance's
-- amount and cadence (`member_allowance`) and nothing of what is drawn from it.
-- The household's totals still count each allowance at the larger of its amount
-- and its drawn total, so a co-member reads that drawn total, summed and with no
-- item detail, through `hidden_allowance_drawn`.
--
-- Roles that bypass RLS (`service_role`, used by the edge functions that compute
-- the household buffer and pay splits) still see every line.

-- ── Budget line policy ───────────────────────────────────────────────────────
--
-- Household membership gates every line; a line drawn from an allowance is
-- further gated to the member it is drawn from, on read and on write alike, so a
-- member can neither see nor draw a line from a co-member's allowance.

drop policy "household members manage budget lines" on public.budget_line;

create policy "household members manage budget lines" on public.budget_line
  for all to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (allowance_member_id is null or allowance_member_id in (select public.current_member_ids()))
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (allowance_member_id is null or allowance_member_id in (select public.current_member_ids()))
  );

comment on column public.budget_line.allowance_member_id is 'The member whose allowance this line is drawn from; only a manual Discretionary line with no destination of its own may set it. The line counts against the allowance rather than on top of it, routes with the allowance, and is readable and writable only by that member.';

-- ── What co-members may know of drawn lines ──────────────────────────────────
--
-- Per co-member allowance: the fortnightly and annual totals of the lines drawn
-- from it, normalised exactly as the client does (each line annualised, then its
-- fortnightly share rounded, then summed). The caller's own allowance is absent:
-- they read their own lines directly.

create function public.hidden_allowance_drawn()
returns table (
  member_id uuid,
  drawn_fortnightly_cents bigint,
  drawn_annual_cents bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with drawn as (
    select
      a.member_id,
      public.reconcile_annual_cents(b.amount_cents, b.frequency, b.interval_count) as annual
    from public.member_allowance a
    left join public.budget_line b
      on b.allowance_member_id = a.member_id and b.household_id = a.household_id
    where a.household_id in (select public.household_ids_for_current_user())
      and a.member_id not in (select public.current_member_ids())
  )
  select
    member_id,
    coalesce(sum(floor(annual::numeric / 26 + 0.5)), 0)::bigint,
    coalesce(sum(annual), 0)::bigint
  from drawn
  group by member_id;
$$;
comment on function public.hidden_allowance_drawn() is 'The total drawn from each co-member''s allowance, fortnightly and annual cents, with no item detail; the caller''s own allowance is omitted.';

revoke execute on function public.hidden_allowance_drawn() from public;
grant execute on function public.hidden_allowance_drawn() to authenticated;
