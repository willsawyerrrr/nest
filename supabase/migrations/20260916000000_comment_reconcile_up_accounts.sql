-- Document reconcile_up_accounts, whose creating migration commented everything but it.
--
-- 20260903000000 created public.reconcile_up_accounts(uuid, uuid, text[]) with a
-- file header explaining it and `comment on` for the new column and both
-- recreated views, but none for the function, so `\df+` and the schema dump
-- carry nothing. Every other function in the schema is commented; this brings
-- the per-member account reconcile into line, as 20260914000000 did for its
-- joint twin. A forward migration, since the file that created the function is
-- already merged and immutable.

comment on function public.reconcile_up_accounts(uuid, uuid, text[])
  is 'Reconciles one member''s individually-owned (`owner_member_id = p_owner_member_id`) `source = ''up''` accounts against the Up account ids that member''s own token returned this run; up-sync calls it once per member after the account upsert, and a failed or absent token read reconciles nothing (an empty list is a valid "this member has no Up accounts" result). An account no longer reported and referenced by nothing is deleted (its account_balance cascades); one still referenced by a savings goal, a budget line''s funding account, the household pay account, or a member''s super link is kept and stamped `deleted_from_source_at`; an account that reappears in a later run has the stamp cleared. The individually-owned half of the account reconcile, keyed on `owner_member_id = p_owner_member_id`; reconcile_joint_up_accounts is the joint twin, keyed on `owner_member_id is null`.';
