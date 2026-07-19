-- Lock members.up_connected_at to service-role writes.
--
-- up_connected_at is the client-visible "Up connected" flag, set and cleared
-- only by the SECURITY DEFINER RPCs store_up_token / clear_up_token. A client
-- must not be able to fake it, so authenticated loses the blanket table-level
-- UPDATE and gets column-scoped UPDATE on just the profile fields it edits
-- (name, email). up_connected_at (and every other column) is excluded, so a
-- direct authenticated UPDATE of it is rejected outright. The RPCs run as their
-- owner and keep full UPDATE, so they still stamp and clear the flag.

revoke update on public.members from authenticated;
grant update (name, email) on public.members to authenticated;
