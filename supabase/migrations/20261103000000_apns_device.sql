-- Native iOS push: APNs device tokens and the APNs auth key that signs pushes to them.
--
-- The native app registers for remote notifications and stores the device token
-- here, so `notify-eval` and `push-test` reach it over APNs alongside the Web
-- Push devices in `push_subscription`. The token IS the device, so it is
-- globally unique. `environment` records which APNs host mints it: a build
-- signed for development gets a sandbox token that the production host rejects,
-- and the reverse.
--
-- Privacy mirrors `push_subscription`: a token is a bearer capability to make
-- someone's phone buzz, so every command is gated on the owning member
-- (`current_member_ids()`) on top of household membership.

-- ── apns_device ──────────────────────────────────────────────────────────────

create table public.apns_device (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  token text not null unique,
  environment text not null check (environment in ('sandbox', 'production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.apns_device (household_id);
create index on public.apns_device (member_id, household_id);

comment on table public.apns_device is 'One APNs device token per native-app install, owned by the member signed in on it; only that member may read or delete it.';
comment on column public.apns_device.token is 'The hex APNs device token that identifies the install. Unique, so a re-registering device upserts rather than duplicating.';
comment on column public.apns_device.environment is 'Which APNs host the token belongs to: sandbox (development-signed builds) or production.';

create trigger set_updated_at before update on public.apns_device
  for each row execute function public.set_updated_at();

-- ── Row-Level Security: own devices only ─────────────────────────────────────

alter table public.apns_device enable row level security;

create policy "members read own apns devices" on public.apns_device
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members insert own apns devices" on public.apns_device
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members update own apns devices" on public.apns_device
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members delete own apns devices" on public.apns_device
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.apns_device to authenticated;

-- The sender reads devices and prunes the tokens APNs reports as dead. It never
-- inserts or updates one — only the device's own app can mint a token.
grant select, delete on public.apns_device to service_role;

-- ── register_apns_device ─────────────────────────────────────────────────────
--
-- A token follows the install, not the account: after a sign-out and a sign-in
-- as another member, the same token is registered again. A plain upsert from the
-- new member would hit the old member's row and be refused by RLS, leaving the
-- old member's notifications buzzing the new member's phone. This definer
-- function reassigns the token to the caller, who is resolved from the JWT.

create function public.register_apns_device(p_token text, p_environment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member
    from public.members
    where user_id = (select auth.uid())
    order by created_at
    limit 1;
  if not found then
    raise exception 'no household membership for this user' using errcode = '42501';
  end if;

  insert into public.apns_device (household_id, member_id, token, environment)
    values (v_member.household_id, v_member.id, p_token, p_environment)
    on conflict (token) do update
      set household_id = excluded.household_id,
          member_id = excluded.member_id,
          environment = excluded.environment;
end;
$$;

comment on function public.register_apns_device(text, text) is 'Registers (or reassigns to the caller) an APNs device token for the signed-in member.';

revoke execute on function public.register_apns_device(text, text) from public;
grant execute on function public.register_apns_device(text, text) to authenticated;

-- ── APNs auth key — service_role only, the ONLY read path ────────────────────
--
-- One credential set, like `vapid_keys()`: the sender signs the ES256 provider
-- token with the `.p8` private key, naming its key id (`kid`) and the Apple team
-- id (`iss`), and addresses the app by its bundle id (the `apns-topic`). The
-- operator sets and rotates them by hand in Vault (see `docs/operations.md`).

create function public.apns_keys()
returns table (key_id text, team_id text, bundle_id text, private_key text)
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_key_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_team_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_bundle_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_private_key');
$$;

comment on function public.apns_keys() is 'The APNs credential set from Vault (key id, team id, bundle id, .p8 private key). Nulls when unset. service_role only.';

revoke execute on function public.apns_keys() from public;
grant execute on function public.apns_keys() to service_role;
