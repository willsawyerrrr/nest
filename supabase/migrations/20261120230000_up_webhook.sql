-- Per-member Up webhooks: real-time transaction ingestion.
--
-- Each connected member registers their own webhook with Up, at an `up-webhook`
-- URL carrying their member id. Up returns the webhook's HMAC `secretKey` once,
-- at registration, so it is held in Vault under `up_webhook_secret:<member_id>`;
-- `up_webhook` records the webhook's Up id, for replacing or deleting it later.
-- A row exists exactly when its secret does: both are written and cleared
-- together, by SECURITY DEFINER RPCs granted to `service_role` alone.

-- ── up_webhook ────────────────────────────────────────────────────────────────

create table public.up_webhook (
  member_id uuid primary key references public.members on delete cascade,
  webhook_id text not null,
  created_at timestamptz not null default now()
);

comment on table public.up_webhook is 'The Up webhook each connected member registered with their token, delivering to up-webhook?m=<member_id>. Its secret lives in Vault under up_webhook_secret:<member_id>.';
comment on column public.up_webhook.webhook_id is 'Up''s id for the webhook, used to replace or delete it.';

-- Server-only: no client reads or writes it, so `authenticated` holds no grant
-- and no policy. `service_role` reads it to find the members lacking a webhook
-- and the id to delete; every write goes through the RPCs below.
alter table public.up_webhook enable row level security;

revoke all on public.up_webhook from anon, authenticated, service_role;
grant select on public.up_webhook to service_role;

-- ── Store (create or replace) a member's webhook and its secret ──────────────

create function public.store_up_webhook(p_member_id uuid, p_webhook_id text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'up_webhook_secret:' || p_member_id::text;
  v_secret_id uuid;
begin
  select id into v_secret_id from vault.secrets where name = v_name;

  if v_secret_id is null then
    perform vault.create_secret(p_secret, v_name, 'Up webhook signing secret');
  else
    perform vault.update_secret(v_secret_id, p_secret, v_name, null);
  end if;

  insert into public.up_webhook (member_id, webhook_id)
    values (p_member_id, p_webhook_id)
    on conflict (member_id) do update
      set webhook_id = excluded.webhook_id, created_at = now();
end;
$$;

revoke execute on function public.store_up_webhook(uuid, text, text) from public;
grant execute on function public.store_up_webhook(uuid, text, text) to service_role;

-- ── Read a member's decrypted webhook secret — the only read path ────────────

create function public.up_webhook_secret_for_member(p_member_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret
    from vault.decrypted_secrets
    where name = 'up_webhook_secret:' || p_member_id::text;
$$;

revoke execute on function public.up_webhook_secret_for_member(uuid) from public;
grant execute on function public.up_webhook_secret_for_member(uuid) to service_role;

-- ── Clear a member's webhook and its secret ──────────────────────────────────

create function public.clear_up_webhook(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'up_webhook_secret:' || p_member_id::text;
  delete from public.up_webhook where member_id = p_member_id;
end;
$$;

revoke execute on function public.clear_up_webhook(uuid) from public;
grant execute on function public.clear_up_webhook(uuid) to service_role;
