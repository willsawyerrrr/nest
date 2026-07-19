-- Up connection: let each member connect their Up personal access token.
--
-- The token is sensitive and must never reach a client. It is held encrypted in
-- Supabase Vault under a per-member name (`up_token:<member_id>`); the only read
-- path is a SECURITY DEFINER RPC granted to `service_role` alone, used by the
-- server-side sync. Members see a non-sensitive connection flag
-- (`members.up_connected_at`) under the existing members RLS, never the token.

-- ── Connection status (non-sensitive; readable under existing members RLS) ────

alter table public.members
  add column up_connected_at timestamptz;
comment on column public.members.up_connected_at is 'When this member''s Up token was last stored; null when not connected. Never exposes the token itself.';

-- ── Enable Supabase Vault ────────────────────────────────────────────────────

-- Present on Supabase (created if absent); shimmed on plain Postgres in CI,
-- where the extension is unavailable, so the guard skips it there.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists supabase_vault with schema vault;
  end if;
end $$;

-- ── Store (create or update) a member's Up token — service_role only ──────────

create function public.store_up_token(p_member_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'up_token:' || p_member_id::text;
  v_secret_id uuid;
begin
  select id into v_secret_id from vault.secrets where name = v_name;

  if v_secret_id is null then
    perform vault.create_secret(p_token, v_name, 'Up personal access token');
  else
    perform vault.update_secret(v_secret_id, p_token, v_name, null);
  end if;

  update public.members set up_connected_at = now() where id = p_member_id;
end;
$$;

revoke execute on function public.store_up_token(uuid, text) from public;
grant execute on function public.store_up_token(uuid, text) to service_role;

-- ── Read a member's decrypted Up token — service_role only, the ONLY read path ─

create function public.up_token_for_member(p_member_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret
    from vault.decrypted_secrets
    where name = 'up_token:' || p_member_id::text;
$$;

revoke execute on function public.up_token_for_member(uuid) from public;
grant execute on function public.up_token_for_member(uuid) to service_role;

-- ── Clear a member's Up token and connection status — service_role only ───────

create function public.clear_up_token(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'up_token:' || p_member_id::text;
  update public.members set up_connected_at = null where id = p_member_id;
end;
$$;

revoke execute on function public.clear_up_token(uuid) from public;
grant execute on function public.clear_up_token(uuid) to service_role;
