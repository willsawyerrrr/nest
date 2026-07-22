-- Restore any household member missing its gift recipient.
--
-- A member recipient was deleted by hand before the delete path was closed, and
-- the earlier backfill runs only once. This re-runs that backfill so any member
-- currently lacking its recipient regains one; `on conflict do nothing` makes it
-- a no-op wherever the rows already exist.

insert into public.gift_recipient (household_id, member_id, name)
  select household_id, id, name from public.members
  on conflict do nothing;
