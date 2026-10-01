-- `eofy-share` lists a member's deductions under their groups, reading
-- `deduction_group` with a service-role client (the token holder has no
-- `auth.uid()`), so it needs the same surgical select as the other source tables.
grant select on public.deduction_group to service_role;
