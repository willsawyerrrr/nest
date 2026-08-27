-- EOFY share links: a scoped, time-limited, read-only bearer token a household
-- gives to a tax agent, without inviting them as a member or issuing them
-- Supabase credentials.
--
-- Unlike `join_household`, redeeming this token grants no household membership
-- and needs no `auth.uid()` at all — the token itself is the credential, read by
-- the `eofy-share` / `eofy-share-file` edge functions with a service-role
-- client. It follows the temporary-invite-code idiom (opt-in, time-limited,
-- minted/revoked by a SECURITY DEFINER RPC) but issues a token for a bounded
-- read path rather than a join.
--
-- At most one live share per household: `household_id` is the primary key, so
-- `create_share_grant` replaces any existing share rather than adding a second
-- one, and there is no history — `revoke_share_grant` deletes the row outright
-- rather than marking it revoked.

create table public.share_grant (
  household_id uuid primary key references public.households on delete cascade,
  financial_year integer not null,
  token_hash text not null unique,
  recipient_email text not null,
  created_by_member_id uuid references public.members (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.share_grant is 'At most one live, time-limited, read-only EOFY share per household. Not a household membership — a bearer token for a scoped, anonymous read path (eofy-share / eofy-share-file), following the temporary-invite-code TTL idiom but issuing a token for a read, not a join.';
comment on column public.share_grant.financial_year is 'The single financial year this share exposes EOFY data for.';
comment on column public.share_grant.token_hash is 'sha256(token), hex. The plaintext token is returned once by create_share_grant and never stored; only the hash is compared on redemption.';
comment on column public.share_grant.recipient_email is 'The address the share link was sent to, shown back to the household so they can tell who a live share was issued to.';
comment on column public.share_grant.created_by_member_id is 'Which member created the share; set null if that member is later removed, since the share itself still stands.';

-- ── Row-Level Security ───────────────────────────────────────────────────────
--
-- Deliberately tighter than the invite_code precedent, since this token gates
-- real tax data: household members may only ever read their own share (never
-- token_hash, the credential itself), and there is no insert/update/delete
-- policy and no such GRANT to `authenticated` at all — every write goes through
-- create_share_grant / revoke_share_grant (SECURITY DEFINER), so a direct
-- PostgREST write is impossible.

alter table public.share_grant enable row level security;

create policy "household members read their share" on public.share_grant
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

revoke select on public.share_grant from authenticated;
grant select (household_id, financial_year, recipient_email, expires_at, created_at)
  on public.share_grant to authenticated;

-- eofy-share / eofy-share-file resolve a token with a service-role client,
-- reading token_hash to match it — the one path that needs it.
grant select on public.share_grant to service_role;

-- The functions above also read each source table the EOFY tab itself loads,
-- with a service-role client (no `auth.uid()` — the token holder is anonymous),
-- so the household's own RLS policies never apply to them.
grant select on public.members, public.inflows, public.tax_profile,
  public.super_contribution, public.super_profile, public.help_debt,
  public.deduction, public.deduction_receipt, public.payslip
  to service_role;

-- ── RPCs ──────────────────────────────────────────────────────────────────────

create function public.create_share_grant(p_financial_year integer, p_recipient_email text)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_member_id uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires_at timestamptz := now() + interval '7 days';
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  select id into v_member_id
    from public.members
    where user_id = (select auth.uid()) and household_id = v_household_id;

  insert into public.share_grant
      (household_id, financial_year, token_hash, recipient_email, created_by_member_id, expires_at)
    values (
      v_household_id, p_financial_year, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
      p_recipient_email, v_member_id, v_expires_at
    )
    on conflict (household_id) do update set
      financial_year = excluded.financial_year,
      token_hash = excluded.token_hash,
      recipient_email = excluded.recipient_email,
      created_by_member_id = excluded.created_by_member_id,
      expires_at = excluded.expires_at,
      created_at = now();

  return query select v_token, v_expires_at;
end;
$$;

comment on function public.create_share_grant(integer, text) is 'Mints (or replaces) the caller''s household''s single live EOFY share: a 64-hex-char bearer token valid for 7 days, scoped to p_financial_year. Returns the plaintext token once — only its hash is stored.';

revoke execute on function public.create_share_grant(integer, text) from public;
grant execute on function public.create_share_grant(integer, text) to authenticated;

create function public.revoke_share_grant()
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

  delete from public.share_grant where household_id = v_household_id;
end;
$$;

comment on function public.revoke_share_grant() is 'Deletes the caller''s household''s live EOFY share, if any. A no-op when there is none.';

revoke execute on function public.revoke_share_grant() from public;
grant execute on function public.revoke_share_grant() to authenticated;

-- ── Resend API key — service_role only, the ONLY read path ──────────────────
--
-- Mirrors vapid_keys()/anthropic_api_key(): the operator sets and rotates the
-- secret by hand in Vault (see docs/operations.md); there is no store RPC,
-- because nothing in the app writes it.

create function public.resend_api_key()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key';
$$;

comment on function public.resend_api_key() is 'The Resend API key from Vault, for share-create to email an EOFY share link. Null when unset. service_role only.';

revoke execute on function public.resend_api_key() from public;
grant execute on function public.resend_api_key() to service_role;
