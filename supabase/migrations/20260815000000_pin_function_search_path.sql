-- Every function in the schema pins an empty search path.
--
-- `set search_path = ''` forces every reference in a function body to be
-- schema-qualified, so nothing it names can be shadowed by a relation, type, or
-- operator planted in a schema earlier on the caller's path. For a SECURITY
-- DEFINER function that is a privilege-escalation gate; for an invoker trigger it
-- is defence in depth, and it keeps the whole schema uniform so the invariant can
-- be asserted rather than reviewed by eye.
--
-- `prevent_member_recipient_edit` is the one function declared without it. Its
-- body names only trigger locals, so pinning the path changes nothing it resolves.

create or replace function public.prevent_member_recipient_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.member_id is not null then
    raise exception 'Member gift recipients are managed automatically and cannot be edited';
  end if;
  return new;
end;
$$;
