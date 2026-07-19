-- Server-side table grants for the Up edge functions' service_role client.
--
-- The Up functions use the service_role client directly against the ledger:
-- resolveCaller selects a member row, and up-sync selects members and upserts
-- accounts (select + insert + update on the (source, external_id) conflict).
-- The token RPCs are SECURITY DEFINER, so they need no table grants here.
grant select on public.members to service_role;
grant select, insert, update on public.accounts to service_role;
