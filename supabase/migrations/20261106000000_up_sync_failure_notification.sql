-- Notify a member when up-sync's Up token read is rejected (401/403).
--
-- Today a rejected token just skips that member's accounts, reconcile, and
-- gift window silently on every run: nothing surfaces it, so their balances
-- and gift candidates go stale with no feedback. A genuine rejection clears
-- the member's connection rather than retrying forever, and the clearing is
-- distinguishable from an intentional disconnect (`up-disconnect`, which is
-- not a failure and must never trigger a notification).

-- ── Failure status (non-sensitive; readable under existing members RLS) ─────

alter table public.members
  add column up_sync_failed_at timestamptz;
comment on column public.members.up_sync_failed_at is 'When up-sync''s token read for this member was last rejected (401/403); null otherwise. Distinct from up_connected_at: connecting or an intentional disconnect (up-disconnect) both clear it, so it means only "needs reconnecting due to a real failure", never "chose not to connect".';

-- ── Fail a member's Up token — service_role only ────────────────────────────
--
-- Called by up-sync when listing a member's Up accounts is rejected with 401
-- or 403. Clears the connection (so the member is prompted to reconnect rather
-- than retried forever) and stamps the failure time the notification trigger
-- reads.

create function public.fail_up_token(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.members
    set up_connected_at = null, up_sync_failed_at = now()
    where id = p_member_id;
end;
$$;

revoke execute on function public.fail_up_token(uuid) from public;
grant execute on function public.fail_up_token(uuid) to service_role;

-- ── Connecting or disconnecting resolves any prior failure ──────────────────

create or replace function public.store_up_token(p_member_id uuid, p_token text)
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

  update public.members set up_connected_at = now(), up_sync_failed_at = null where id = p_member_id;
end;
$$;

create or replace function public.clear_up_token(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'up_token:' || p_member_id::text;
  update public.members set up_connected_at = null, up_sync_failed_at = null where id = p_member_id;
end;
$$;

-- ── Notification trigger ─────────────────────────────────────────────────────
--
-- `members` is already granted select to service_role (the EOFY share path),
-- so the evaluator needs no new grant to read up_sync_failed_at.

alter type public.notification_trigger add value 'up_disconnected';

comment on type public.notification_trigger is 'The today''s-data conditions notify-eval checks daily. Deposit-landed and bill-due triggers need ingestion and are out of scope here.';
