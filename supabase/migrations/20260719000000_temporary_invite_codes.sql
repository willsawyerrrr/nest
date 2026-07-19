-- Temporary, opt-in household invite codes.
--
-- A household carries no invite code by default. A member opts in by generating
-- one; it is single-use and expires after 7 days, whichever comes first. Members
-- can regenerate (replacing the code and resetting expiry) or revoke it. Joining
-- with a code consumes it immediately.

-- ── Schema: make the code temporary and opt-in ──────────────────────────────

-- Drop the auto-generating default and the always-present constraints, then add
-- the expiry column. Existing persistent codes are cleared so nothing is shown
-- until a member deliberately regenerates one.
alter table public.households
  alter column invite_code drop not null,
  alter column invite_code drop default,
  add column invite_code_expires_at timestamptz;
comment on column public.households.invite_code is 'A single-use invite code a partner redeems to join; null when none is active.';
comment on column public.households.invite_code_expires_at is 'When the active invite code expires; null when no code is active.';

update public.households
  set invite_code = null, invite_code_expires_at = null;

-- ── Generate an invite code for the caller's household ───────────────────────

create function public.create_invite_code()
returns table (invite_code text, invite_code_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_code text := substr(md5(gen_random_uuid()::text), 1, 8);
  v_expires_at timestamptz := now() + interval '7 days';
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  update public.households
    set invite_code = v_code, invite_code_expires_at = v_expires_at
    where id = v_household_id;

  return query select v_code, v_expires_at;
end;
$$;

revoke execute on function public.create_invite_code() from public;
grant execute on function public.create_invite_code() to authenticated;

-- ── Revoke the caller's household's invite code ──────────────────────────────

create function public.revoke_invite_code()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  update public.households
    set invite_code = null, invite_code_expires_at = null
    where id = v_household_id;
end;
$$;

revoke execute on function public.revoke_invite_code() from public;
grant execute on function public.revoke_invite_code() to authenticated;

-- ── Join RPC: match only an active code, and consume it on success ───────────

create or replace function public.join_household(p_code text, p_member_name text)
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
    where invite_code = p_code
      and invite_code is not null
      and invite_code_expires_at > now();

  if v_household_id is null then
    raise exception 'invalid or expired invite code';
  end if;

  insert into public.members (household_id, user_id, name, email)
    values (v_household_id, (select auth.uid()), p_member_name, (select auth.jwt() ->> 'email'))
    on conflict (household_id, user_id) do nothing;

  update public.households
    set invite_code = null, invite_code_expires_at = null
    where id = v_household_id;

  return v_household_id;
end;
$$;
