-- Anthropic API key: the credential the payslip-extract function reads slips with.
--
-- One household-wide key, not a per-member secret, so it is a single Vault entry
-- named `anthropic_api_key`. It is sensitive and must never reach a client, so it
-- follows `up_token_for_member`'s shape exactly: the only read path is a SECURITY
-- DEFINER function granted to `service_role` alone, called by the edge function
-- with its service-role client. There is no store RPC — no client ever supplies
-- this key, so the operator writes it by hand once (see docs/operations.md).

-- Present on Supabase (created by the Up connection migration, kept idempotent
-- here); shimmed on plain Postgres in CI, where the extension is unavailable, so
-- the guard skips it there.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists supabase_vault with schema vault;
  end if;
end $$;

-- ── Read the decrypted key — service_role only, the ONLY read path ────────────

create function public.anthropic_api_key()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key';
$$;

comment on function public.anthropic_api_key() is 'The Anthropic API key from Vault, for the payslip-extract edge function; readable by service_role alone and never returned to a client. Null when the operator has not set the secret, which degrades extraction to manual entry.';

revoke execute on function public.anthropic_api_key() from public;
grant execute on function public.anthropic_api_key() to service_role;
