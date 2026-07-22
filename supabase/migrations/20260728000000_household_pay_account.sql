-- Household pay account: the single spending account the household's pay lands in.
--
-- The Splits tab designates one household-level spending (transaction) account as
-- the source pay lands in. Pay stays there; every other routed account — the
-- other spending accounts and the savers — becomes a recommended pay split. The
-- designation lives on the household so both partners share it, and is written
-- only through a SECURITY DEFINER RPC that validates the account, keeping
-- households writes controlled rather than opening a broad column update.

-- ── Pay-account column ───────────────────────────────────────────────────────

alter table public.households
  add column pay_account_id uuid,
  add constraint households_pay_account_id_fkey
    foreign key (pay_account_id, id)
    references public.accounts (id, household_id) on delete set null;
comment on column public.households.pay_account_id is 'The single spending account the household''s pay lands in; the Splits tab treats it as the source and recommends splitting to every other routed account.';

-- ── Set (or clear) the caller's household pay account ─────────────────────────

create function public.set_household_pay_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  if p_account_id is not null and not exists (
    select 1 from public.accounts
    where id = p_account_id
      and household_id = v_household_id
      and type = 'transaction'
  ) then
    raise exception 'pay account must be a transaction account in the caller''s household';
  end if;

  update public.households
    set pay_account_id = p_account_id
    where id = v_household_id;
end;
$$;

revoke execute on function public.set_household_pay_account(uuid) from public;
grant execute on function public.set_household_pay_account(uuid) to authenticated;
