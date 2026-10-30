-- Notify when a gift purchase is logged without a recipient or occasion.
--
-- An unassigned purchase (neither a gift budget nor the discretionary buffer)
-- is easy to forget until months later. `notify-eval` pushes one notification
-- per recent unassigned purchase, deduped on the purchase id, to every member
-- with a device who has left the trigger on. An unassigned purchase carries no
-- recipient tag, so every household member can already read it.

alter type public.notification_trigger add value 'gift_purchase_unassigned';

comment on type public.notification_trigger is 'The today''s-data conditions notify-eval checks daily. Deposit-landed and bill-due triggers need ingestion and are out of scope here.';

-- The evaluator reads gift purchases with a service-role client, like the other
-- plan tables it reconciles.
grant select on public.gift_purchase to service_role;
