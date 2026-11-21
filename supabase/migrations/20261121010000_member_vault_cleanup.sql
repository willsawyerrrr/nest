-- A member's Vault secrets go with the member.
--
-- `up_token:<member_id>` and `up_webhook_secret:<member_id>` are named after
-- the member rather than keyed to it, so no foreign key cascades them away.
-- This trigger deletes both whenever a `members` row is deleted, directly or
-- through its household's cascade; a member with neither deletes nothing.
--
-- The webhook registered at Up is not deleted here: SQL cannot call Up. It keeps
-- delivering to `up-webhook`, which answers `401` for a member with no secret.

create function public.clear_member_vault_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
    where name in ('up_token:' || old.id::text, 'up_webhook_secret:' || old.id::text);
  return old;
end;
$$;

revoke execute on function public.clear_member_vault_secrets() from public;

create trigger members_clear_vault_secrets
  after delete on public.members
  for each row execute function public.clear_member_vault_secrets();
