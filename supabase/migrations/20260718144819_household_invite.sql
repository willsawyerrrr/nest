-- Household invites: let a partner join an existing household via a shared code.
--
-- Each household carries a short, unique invite code. A signed-in user who is
-- not yet a member can redeem the code to enrol themselves as a member. The
-- redemption RPC is SECURITY DEFINER so a not-yet-member can resolve the code
-- past RLS; it only ever adds the caller.

-- ── Invite code column ───────────────────────────────────────────────────────

alter table public.households
  add column invite_code text not null unique
    default substr(md5(gen_random_uuid()::text), 1, 8);
comment on column public.households.invite_code is 'Short shared secret a partner redeems to join the household.';

-- ── Join RPC: enrol the caller into a household by its invite code ────────────

create function public.join_household(p_code text, p_member_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'must be authenticated';
  end if;

  select id into v_household_id
    from public.households
    where invite_code = p_code;

  if v_household_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into public.members (household_id, user_id, name, email)
    values (v_household_id, (select auth.uid()), p_member_name, (select auth.jwt() ->> 'email'))
    on conflict (household_id, user_id) do nothing;

  return v_household_id;
end;
$$;

revoke execute on function public.join_household(text, text) from public;
grant execute on function public.join_household(text, text) to authenticated;
