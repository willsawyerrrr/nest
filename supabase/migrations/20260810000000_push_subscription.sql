-- Web Push subscriptions and the VAPID keypair that signs pushes to them.
--
-- A member opts each device in separately: the browser's PushManager mints a
-- subscription (an endpoint URL on the push service plus the two keys that
-- encrypt the payload for that device), and the PWA stores it here. The endpoint
-- IS the device, so it is globally unique and the client upserts on it — a
-- re-subscribe on the same device refreshes its keys instead of accumulating rows.
--
-- Privacy: unlike the rest of the household's shared planning data, a
-- subscription is readable and deletable only by the member who owns the device.
-- An endpoint is a bearer capability to make someone's phone buzz, so a member
-- must not be able to read (and so replay) or delete a co-member's device rows.
-- This is a real boundary, not cosmetic — hence per-command policies gated on
-- `current_member_ids()` on top of household membership, rather than the blanket
-- household-membership policy the shared tables use.

-- ── push_subscription ────────────────────────────────────────────────────────

create table public.push_subscription (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.push_subscription (household_id);
create index on public.push_subscription (member_id, household_id);

comment on table public.push_subscription is 'One Web Push subscription per opted-in device, owned by the member whose device it is; only that member may read or delete it.';
comment on column public.push_subscription.endpoint is 'The push service URL that identifies the device. Unique, so a re-subscribing device upserts on conflict rather than duplicating.';
comment on column public.push_subscription.p256dh is 'The subscription''s P-256 public key (base64url), the ECDH peer for the aes128gcm payload encryption.';
comment on column public.push_subscription.auth is 'The subscription''s auth secret (base64url), mixed into the payload encryption key derivation.';

create trigger set_updated_at before update on public.push_subscription
  for each row execute function public.set_updated_at();

-- ── Row-Level Security: own devices only ─────────────────────────────────────

alter table public.push_subscription enable row level security;

create policy "members read own push subscriptions" on public.push_subscription
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members insert own push subscriptions" on public.push_subscription
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

-- An upsert on the endpoint that lands on a co-member's row must fail rather
-- than silently reassign their device, so the update `using` clause is gated on
-- the existing row's member too.
create policy "members update own push subscriptions" on public.push_subscription
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

create policy "members delete own push subscriptions" on public.push_subscription
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and member_id in (select public.current_member_ids())
  );

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.push_subscription to authenticated;

-- The sender reads the caller's subscriptions and prunes the endpoints the push
-- service reports as gone. It never inserts or updates one — only a device's own
-- browser can mint a subscription — so it holds no more than select and delete.
grant select, delete on public.push_subscription to service_role;

-- ── VAPID keypair — service_role only, the ONLY read path ────────────────────
--
-- The three secrets are one credential set: the sender needs all of them in the
-- same breath (the private key to sign the ES256 VAPID JWT, the public key for
-- its `k=` parameter, the `mailto:` subject for its `sub` claim), so one function
-- returning the set costs one round trip and one grant instead of three. The
-- operator sets and rotates them by hand in Vault (see
-- `docs/operations.md`) — there is no store RPC, because nothing in the app
-- writes them.
--
-- The public key is not itself a secret, but it is kept beside its pair so a
-- rotation is a single Vault change, and the `push-key` function serves it from
-- here rather than from a build-time env var.

create function public.vapid_keys()
returns table (public_key text, private_key text, subject text)
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_subject');
$$;

comment on function public.vapid_keys() is 'The Web Push VAPID credential set from Vault (base64url public key, base64url private key, mailto: subject). Nulls when unset. service_role only.';

revoke execute on function public.vapid_keys() from public;
grant execute on function public.vapid_keys() to service_role;
