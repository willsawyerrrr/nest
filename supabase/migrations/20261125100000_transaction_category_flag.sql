-- A member can flag a transaction's Up category as wrong without changing it.
--
-- The review notification offers Looks right and Wrong category, never a
-- category picker: Wrong category records the flag and leaves the transaction
-- awaiting review, marked flagged, until its category is fixed in the app.
-- The flag is distinct from "not yet reviewed": a flagged transaction is
-- unreviewed AND known to be miscategorised.
--
-- `flag_transaction_category` sets the flag; `review_transaction`, the
-- only other client write path to `transactions`, clears it when it marks the
-- transaction reviewed. Any change to the Up category clears it too, whichever
-- path writes the category (`up-categorise`'s `set_up_transaction_category`, or
-- a sync picking up a change made in Up), through a trigger.

alter table public.transactions
  add column category_flagged_wrong_at timestamptz,
  add column category_flagged_wrong_by_member_id uuid,
  add constraint transactions_category_flagged_wrong_by_member_id_fkey
    foreign key (category_flagged_wrong_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (category_flagged_wrong_by_member_id);

create index on public.transactions (category_flagged_wrong_by_member_id, household_id);

comment on column public.transactions.category_flagged_wrong_at is 'When a member flagged the Up category as wrong; null when unflagged. Cleared when the category changes or the transaction is marked reviewed. Nest-owned: a source sync never sets it.';
comment on column public.transactions.category_flagged_wrong_by_member_id is 'The member who flagged the Up category as wrong; null when unflagged or once that member is removed.';

-- ── A category change clears the flag ────────────────────────────────────────

create function public.clear_transaction_category_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.category_flagged_wrong_at := null;
  new.category_flagged_wrong_by_member_id := null;
  return new;
end;
$$;

comment on function public.clear_transaction_category_flag() is 'Clears a transaction''s wrong-category flag when its Up category changes.';

create trigger clear_category_flag_on_category_change
  before update of external_category on public.transactions
  for each row
  when (old.external_category is distinct from new.external_category
    and old.category_flagged_wrong_at is not null)
  execute function public.clear_transaction_category_flag();

-- ── flag_transaction_category: flag the Up category as wrong ─────────────────
--
-- Runs as its owner and re-applies review_transaction's visibility predicate,
-- for the same reason: members hold no `update` grant on `transactions`.

create function public.flag_transaction_category(p_transaction_id uuid)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  update public.transactions t
    set category_flagged_wrong_at = now(),
      category_flagged_wrong_by_member_id = (
        select m.id from public.members m
        where m.household_id = t.household_id and m.user_id = (select auth.uid())
      ),
      reviewed_at = null,
      reviewed_by_member_id = null
    where t.id = p_transaction_id
      and t.household_id in (select public.household_ids_for_current_user())
      and t.account_id in (select public.visible_balance_account_ids())
      and t.id not in (select public.hidden_gift_transaction_ids_for_current_member())
    returning t.* into v_row;

  if not found then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

comment on function public.flag_transaction_category(uuid) is 'Flags the Up category of a transaction the caller can see as wrong, stamping the caller''s member and returning it to unreviewed, and returns the row. Leaves the category and note.';

revoke execute on function public.flag_transaction_category(uuid) from public;
grant execute on function public.flag_transaction_category(uuid) to authenticated;

-- ── review_transaction: marking reviewed clears the flag ─────────────────────

create or replace function public.review_transaction(
  p_transaction_id uuid,
  p_note text default null,
  p_reviewed boolean default true
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  update public.transactions t
    set notes = case when p_note is null then t.notes else nullif(btrim(p_note), '') end,
      reviewed_at = case
        when p_reviewed is null then t.reviewed_at
        when p_reviewed then now()
      end,
      reviewed_by_member_id = case
        when p_reviewed is null then t.reviewed_by_member_id
        when p_reviewed then (
          select m.id from public.members m
          where m.household_id = t.household_id and m.user_id = (select auth.uid())
        )
      end,
      category_flagged_wrong_at = case
        when p_reviewed then null else t.category_flagged_wrong_at
      end,
      category_flagged_wrong_by_member_id = case
        when p_reviewed then null else t.category_flagged_wrong_by_member_id
      end
    where t.id = p_transaction_id
      and t.household_id in (select public.household_ids_for_current_user())
      and t.account_id in (select public.visible_balance_account_ids())
      and t.id not in (select public.hidden_gift_transaction_ids_for_current_member())
    returning t.* into v_row;

  if not found then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

comment on function public.review_transaction(uuid, text, boolean) is 'Sets the note and review state of a transaction the caller can see, returning the row. p_note null leaves the note, blank clears it, anything else is stored trimmed. p_reviewed true marks it reviewed now by the caller''s member and clears any wrong-category flag, false returns it to unreviewed, null leaves the review state. With flag_transaction_category, the only client write paths to `transactions`.';
