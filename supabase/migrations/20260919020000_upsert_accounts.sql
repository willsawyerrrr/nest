-- Generalise upsert_up_accounts to upsert_accounts.
--
-- The function already reads `source` off each input row rather than
-- hardcoding 'up', so only its name is Up-specific; renaming it lets
-- redbark-sync share the one RPC instead of duplicating it. Body unchanged.

drop function public.upsert_up_accounts(jsonb);

create function public.upsert_accounts(rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_account_id uuid;
begin
  for r in select * from jsonb_array_elements(rows)
  loop
    insert into public.accounts
      (household_id, owner_member_id, name, type, source, external_id, currency)
    values (
      (r ->> 'household_id')::uuid,
      nullif(r ->> 'owner_member_id', '')::uuid,
      r ->> 'name',
      (r ->> 'type')::public.account_type,
      (r ->> 'source')::public.ledger_source,
      r ->> 'external_id',
      coalesce(r ->> 'currency', 'AUD')
    )
    on conflict (source, external_id) do update set
      household_id = excluded.household_id,
      owner_member_id = excluded.owner_member_id,
      name = excluded.name,
      type = excluded.type,
      currency = excluded.currency
    returning id into v_account_id;

    insert into public.account_balance (account_id, household_id, balance_cents)
    values (v_account_id, (r ->> 'household_id')::uuid, (r ->> 'balance_cents')::bigint)
    on conflict (account_id) do update set
      household_id = excluded.household_id,
      balance_cents = excluded.balance_cents;
  end loop;
end;
$$;

comment on function public.upsert_accounts(jsonb)
  is 'Upserts a batch of ledger accounts and their balances in one transaction: identity on (source, external_id), balance on account_id. Each input row carries its own source (''up'' or ''redbark'') as data rather than the function hardcoding one, so up-sync and redbark-sync share this single RPC.';

revoke execute on function public.upsert_accounts(jsonb) from public;
grant execute on function public.upsert_accounts(jsonb) to service_role;
