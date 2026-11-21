-- Prompt a member to review each new Up transaction they made.
--
-- up-sync and up-webhook notify for the transactions they insert, and
-- notify-eval re-evaluates the last two days as a backstop. Unlike every other
-- trigger, `transaction_review` is opt-in: a member with no
-- `notification_preference` row for it is not notified (the evaluator's and
-- the clients' per-trigger default), so no existing member is enrolled.
--
-- A joint account's transaction notifies only its purchaser, so a gift bought
-- on it never pings its recipient. Up names the purchaser by handle (its
-- `performingCustomer.displayName`, e.g. `$alex`), not by the member's Nest
-- name; `up_customer_handles` learns each member's handles from their own
-- individual accounts, where every transaction is theirs.

-- `add value` cannot be used in the transaction that adds it; nothing below
-- names the new value.
alter type public.notification_trigger add value 'transaction_review';

comment on type public.notification_trigger is 'The conditions notifications are sent for: notify-eval checks the daily ones, and up-sync and up-webhook send transaction_review as each Up transaction lands (notify-eval retrying it for two days). transaction_review is opt-in; every other trigger is on until a member turns it off.';
comment on column public.notification_log.dedupe_key is 'What makes a notification "the same one" for its trigger: buffer -> financial year (re-notify after 14 days); goal -> `<goal_id>:<target_date>`; temporary item -> `<item_id>`; FY boundary -> `<financial_year>`; gift purchase and gift candidate -> the purchase or transaction id; Up disconnection -> `<member_id>:<failed_at>`; transaction review -> the transaction id.';
comment on column public.notification_preference.enabled is 'Whether the member gets this trigger. An absent row means on, except for transaction_review, which is off until the member turns it on.';

-- ── Up handles per member — service_role only ───────────────────────────────

create function public.up_customer_handles(p_household_id uuid)
returns table (member_id uuid, handle text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct a.owner_member_id, t.performing_customer_name
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.household_id = p_household_id
    and t.source = 'up'
    and a.owner_member_id is not null
    and t.performing_customer_name is not null;
$$;

comment on function public.up_customer_handles(uuid) is 'Each Up handle (performing_customer_name) seen on a member''s own individual Up accounts, for matching a joint-account transaction to the member who made it. Invoker rights: reads under service_role''s existing select grants on transactions and accounts.';

revoke execute on function public.up_customer_handles(uuid) from public;
grant execute on function public.up_customer_handles(uuid) to service_role;

-- The prompt names the transaction's Up category.
grant select on public.up_category to service_role;
