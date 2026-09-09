-- Document reconcile_joint_up_accounts, the one reconcile function without a comment.
--
-- 20260903010000 created public.reconcile_joint_up_accounts(uuid, text[]) with a
-- file header explaining it but no `comment on function`, so `\df+` and the
-- schema dump carry nothing. Every other function in the schema is commented;
-- this brings the joint reconcile into line. A forward migration, since the file
-- that created the function is already merged and immutable.

comment on function public.reconcile_joint_up_accounts(uuid, text[])
  is 'Reconciles one household''s joint (owner-less) `source = ''up''` accounts against the union of the Up account ids every connected member''s token returned this run; up-sync calls it once per household, only when all of them synced with a readable token. An id no longer in the union and referenced by nothing is deleted (its account_balance cascades); one still referenced by a savings goal, a budget line''s funding account, the household pay account, or a member''s super link is kept and stamped `deleted_from_source_at`; an id that reappears in a later run has the stamp cleared. The joint half of reconcile_up_accounts, keyed on `owner_member_id is null`.';
