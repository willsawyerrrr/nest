-- Household members are permanent gift recipients.
--
-- Each household member is unconditionally a gift recipient: auto-created when the
-- member is, and removed only when the member is. Adding a recipient by hand is
-- therefore for external people alone, and a member recipient is neither editable
-- nor deletable through the UI. The schema enforces the invariants — one recipient
-- per member, a member link that cascades on member delete, and rejected edits to
-- a member recipient.

-- ── One recipient per member ─────────────────────────────────────────────────

create unique index gift_recipient_household_member_key
  on public.gift_recipient (household_id, member_id)
  where member_id is not null;
comment on index public.gift_recipient_household_member_key is 'At most one gift recipient links to a given household member.';

-- ── Member link cascades: a member recipient exists iff the member does ──────

alter table public.gift_recipient
  drop constraint gift_recipient_member_id_household_id_fkey,
  add constraint gift_recipient_member_id_household_id_fkey
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade;

-- ── Backfill: every existing member gets its recipient ───────────────────────

insert into public.gift_recipient (household_id, member_id, name)
  select household_id, id, name from public.members
  on conflict do nothing;

-- ── Auto-create a member's recipient on insert ───────────────────────────────
--
-- SECURITY DEFINER so it bypasses gift_recipient insert RLS regardless of the
-- caller — members are inserted through the SECURITY DEFINER onboarding and
-- join_household RPCs, and this single trigger covers every path.
create function public.add_member_gift_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gift_recipient (household_id, member_id, name)
    values (new.household_id, new.id, new.name)
    on conflict do nothing;
  return new;
end;
$$;
comment on function public.add_member_gift_recipient() is 'Auto-creates the gift recipient that represents a newly inserted household member.';

create trigger add_gift_recipient after insert on public.members
  for each row execute function public.add_member_gift_recipient();

-- ── Guard: a member recipient cannot be edited ───────────────────────────────
--
-- A member recipient is managed automatically; only external recipients
-- (member_id null) are hand-editable. DELETE is intentionally left unguarded so
-- the member FK cascade can remove the row when the member is deleted; the UI
-- simply offers no delete for member recipients.
create function public.prevent_member_recipient_edit()
returns trigger
language plpgsql
as $$
begin
  if old.member_id is not null then
    raise exception 'Member gift recipients are managed automatically and cannot be edited';
  end if;
  return new;
end;
$$;
comment on function public.prevent_member_recipient_edit() is 'Rejects updates to a gift recipient that represents a household member.';

create trigger prevent_member_recipient_edit before update on public.gift_recipient
  for each row execute function public.prevent_member_recipient_edit();
