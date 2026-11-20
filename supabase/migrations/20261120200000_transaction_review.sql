-- Notes and review state on transactions.
--
-- A member confirms each synced transaction and can annotate it; Up's API holds
-- no household note, so both live in Nest. A joint-account transaction is one
-- shared row, so its note and review are shared by both partners, and the last
-- write wins.
--
-- `review_transaction` is the only client write path to `transactions`: members
-- hold no table `update` grant, so a synced row's amount, account, ids, and Up
-- detail stay as the sync wrote them. Row-level security cannot scope an update
-- to columns, and a column grant would let a member stamp a co-member as the
-- reviewer, so the function runs as its owner and re-applies the `update`
-- policy's visibility predicate itself.

alter table public.transactions
  add column reviewed_at timestamptz,
  add column reviewed_by_member_id uuid,
  add constraint transactions_reviewed_by_member_id_fkey
    foreign key (reviewed_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (reviewed_by_member_id);

create index on public.transactions (reviewed_by_member_id, household_id);

comment on column public.transactions.reviewed_at is 'When a member last confirmed the transaction; null while it awaits review. Nest-owned: a source sync never writes it.';
comment on column public.transactions.reviewed_by_member_id is 'The member who last confirmed the transaction; null while it awaits review or once that member is removed.';

-- ── review_transaction: set a transaction's note and review state ─────────────

create function public.review_transaction(
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

comment on function public.review_transaction(uuid, text, boolean) is 'Sets the note and review state of a transaction the caller can see, returning the row. p_note null leaves the note, blank clears it, anything else is stored trimmed. p_reviewed true marks it reviewed now by the caller''s member, false returns it to unreviewed, null leaves the review state. The only client write path to `transactions`.';

revoke execute on function public.review_transaction(uuid, text, boolean) from public;
grant execute on function public.review_transaction(uuid, text, boolean) to authenticated;

-- ── Members write transactions only through review_transaction ───────────────

revoke update on public.transactions from authenticated;
drop policy "household members update visible-balance transactions" on public.transactions;
