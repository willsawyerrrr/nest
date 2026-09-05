-- Document intake: letting a member get a payslip or deduction receipt into Nest
-- from outside the PWA — an iOS Shortcut run from the system share sheet (Mail,
-- Files, a scanned document) posts the file to the `document-intake` edge
-- function, which stages it here for the household to review from the Payslips
-- or Deductions tab. Nothing is created from an inbound share automatically: a
-- staged file becomes a payslip or deduction only when a member opens it in the
-- ordinary add form (pre-filled by the very same extraction pipeline a picked
-- file already goes through) and saves — exactly the "every field stays
-- editable, the member's own save persists" rule extraction already follows.
--
-- Two tables:
--
-- `document_intake_token` is the credential a Shortcut carries: one live,
-- long-lived bearer token per member, minted and revoked by the member it
-- belongs to (mirroring `up-connect`/`up-disconnect`'s own-member-only shape,
-- not `share_grant`'s any-caller-for-the-household one, since this token acts
-- as a specific member submitting their own documents). Follows `share_grant`'s
-- token idiom otherwise: only `token_hash` is stored, the plaintext is returned
-- once, and every write goes through a SECURITY DEFINER RPC.
--
-- `document_intake` is the staging row a successful upload creates: which
-- household and member it belongs to, which kind of document it claims to be,
-- and where its file sits in the private `document-intake` bucket. Household
-- members can read and delete these rows (review or dismiss), exactly the same
-- household-wide boundary as `payslip`/`deduction` — `member_id` is a tax
-- attribution here too, not a privacy boundary. Only the edge function
-- (`service_role`) inserts one: an authenticated member never writes this table
-- directly, since a row here is only ever the record of an inbound upload the
-- token already authorised.

-- ── Document intake tokens ────────────────────────────────────────────────────

create table public.document_intake_token (
  member_id uuid primary key,
  household_id uuid not null references public.households on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
comment on table public.document_intake_token is 'At most one live document-intake bearer token per member, minted/revoked only by that member (create_document_intake_token / revoke_document_intake_token). Lets an iOS Shortcut authenticate to document-intake as this member without a Supabase session.';
comment on column public.document_intake_token.token_hash is 'sha256(token), hex. The plaintext token is returned once by create_document_intake_token and never stored; only the hash is compared on redemption.';

alter table public.document_intake_token enable row level security;

-- Household-wide read of *whether* a member has a live token and since when —
-- the same transparency `members.up_connected_at` gives for the Up connection
-- — but never the credential itself.
create policy "household members read intake token status" on public.document_intake_token
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

revoke select on public.document_intake_token from authenticated;
grant select (member_id, household_id, created_at) on public.document_intake_token to authenticated;

-- document-intake resolves a token with a service-role client (no auth.uid()
-- for the token holder), reading token_hash to match it.
grant select on public.document_intake_token to service_role;

create function public.create_document_intake_token()
returns table (token text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_member_id uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_created_at timestamptz := now();
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

  if v_member_id is null then
    raise exception 'caller has no member row';
  end if;

  insert into public.document_intake_token (member_id, household_id, token_hash, created_at)
    values (v_member_id, v_household_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_created_at)
    on conflict (member_id) do update set
      token_hash = excluded.token_hash,
      created_at = excluded.created_at;

  return query select v_token, v_created_at;
end;
$$;

comment on function public.create_document_intake_token() is 'Mints (or replaces) the caller''s own member''s document-intake bearer token: a 64-hex-char credential a Shortcut carries indefinitely, until revoked. Returns the plaintext token once — only its hash is stored.';

revoke execute on function public.create_document_intake_token() from public;
grant execute on function public.create_document_intake_token() to authenticated;

create function public.revoke_document_intake_token()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  select id into v_member_id from public.members where user_id = (select auth.uid());

  if v_member_id is null then
    raise exception 'caller has no member row';
  end if;

  delete from public.document_intake_token where member_id = v_member_id;
end;
$$;

comment on function public.revoke_document_intake_token() is 'Deletes the caller''s own member''s document-intake token, if any. A no-op when there is none.';

revoke execute on function public.revoke_document_intake_token() from public;
grant execute on function public.revoke_document_intake_token() to authenticated;

-- ── Staged uploads awaiting review ───────────────────────────────────────────

create table public.document_intake (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  kind text not null check (kind in ('payslip', 'deduction')),
  storage_path text not null,
  original_filename text,
  created_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.document_intake (household_id, created_at);
create index on public.document_intake (member_id, household_id);

comment on table public.document_intake is 'A file document-intake accepted, staged for review: cleared to a real payslip or deduction (and deleted) once a member opens it in the add form and saves, or deleted outright if dismissed. Never itself a payslip or a deduction.';
comment on column public.document_intake.kind is 'Which add form this file is queued for; the Shortcut that posted it says which.';
comment on column public.document_intake.storage_path is 'Object key in the private `document-intake` bucket, prefixed with the household id as its first path segment for the Storage RLS check.';
comment on column public.document_intake.original_filename is 'The filename the upload carried, shown in the inbox; null when none was given.';

alter table public.document_intake enable row level security;

-- Household-wide review and dismiss, the same boundary as payslip/deduction
-- themselves. No insert policy for authenticated: a row here only ever comes
-- from a validated token upload, never a direct client write.
create policy "household members read and dismiss staged documents" on public.document_intake
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

create policy "household members dismiss staged documents" on public.document_intake
  for delete to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

grant select, delete on public.document_intake to authenticated;

-- document-intake inserts with a service-role client (the token holder has no
-- auth.uid() either).
grant select, insert, delete on public.document_intake to service_role;

-- ── Storage: private `document-intake` bucket ────────────────────────────────
--
-- Objects are laid out as `<household_id>/<intake_id>/<file>`, exactly as the
-- `payslips`/`receipts` buckets are. Only select and delete are granted to
-- authenticated — reviewing downloads the object, dismissing or claiming
-- deletes it — the insert itself always comes from document-intake's
-- service-role client, which bypasses Storage RLS regardless.
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public)
      values ('document-intake', 'document-intake', false)
      on conflict (id) do nothing;

    drop policy if exists "household members read staged document objects" on storage.objects;
    create policy "household members read staged document objects" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'document-intake'
        and ((storage.foldername(name))[1])::uuid
          in (select public.household_ids_for_current_user())
      );

    drop policy if exists "household members delete staged document objects" on storage.objects;
    create policy "household members delete staged document objects" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'document-intake'
        and ((storage.foldername(name))[1])::uuid
          in (select public.household_ids_for_current_user())
      );
  end if;
end $$;
