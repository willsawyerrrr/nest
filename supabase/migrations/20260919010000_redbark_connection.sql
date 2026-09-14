-- Redbark connection: a member's bank connection via Redbark's hosted Link
-- Session flow (a Fiskil/CDR consent redirect, not a pasteable token).
--
-- One platform-wide Redbark API key (an edge function secret, `REDBARK_API_KEY`
-- — not Vault, not per-member; see docs/operations.md) covers every connection
-- this household makes. Redbark exposes no owner/customer-reference field on
-- its own Connection or AccountItem objects, so this table is the only place
-- ownership is tracked: a connection always belongs to the member who completed
-- its consent flow, and every account redbark-sync lands through a connection
-- takes owner_member_id = member_id. Redbark cannot tell Nest whether the
-- underlying account is legally joint, so unlike Up there is no joint-Redbark
-- concept and no joint reconcile pass.
--
-- Every write goes through an edge function that resolves the caller itself
-- (redbark-connect-complete / redbark-disconnect / redbark-sync), so writes are
-- service_role-only; a household member reads their own and their co-member's
-- connections under the same household-membership rule as every other table.

create table public.redbark_connection (
  id text primary key,
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  institution_name text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);
create index on public.redbark_connection (household_id);
comment on table public.redbark_connection is 'A member''s bank connection via Redbark''s hosted Link Session flow. Redbark exposes no owner field on its own Connection object, so ownership is tracked here: every account synced through a connection is attributed to that connection''s member_id, never joint.';

create trigger set_updated_at before update on public.redbark_connection
  for each row execute function public.set_updated_at();

alter table public.redbark_connection enable row level security;

create policy "household members read redbark connections" on public.redbark_connection
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

grant select on public.redbark_connection to authenticated;
grant select, insert, update, delete on public.redbark_connection to service_role;
