-- Notify when a new gift candidate arrives from the Up sync.
--
-- The hourly up-sync rescans a trailing window of gifts-and-charity
-- transactions; until now, a newly-synced candidate surfaced only by opening
-- the Gifts screen's "From your card" inbox. notify-eval pushes one
-- notification per recent, unclaimed, undismissed candidate, deduped on the
-- transaction id, to whichever member can actually see its account — an
-- individually-owned account's candidate goes to its owner alone, a joint
-- account's to both.

alter type public.notification_trigger add value 'gift_candidate_new';

comment on type public.notification_trigger is 'The today''s-data conditions notify-eval checks daily. Deposit-landed and bill-due triggers need ingestion and are out of scope here.';

-- The evaluator reads transactions and dismissals with a service-role client,
-- like the other plan tables it reconciles. `sync_up_gift_transactions` is the
-- only existing service_role path to `transactions` (it runs as its owner), so
-- this is the first straight grant; `accounts` is already granted (see
-- 20260719050000_service_role_ledger_grants.sql).
grant select on public.transactions, public.gift_transaction_dismissal to service_role;
