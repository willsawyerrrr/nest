-- A deduction's basis is fixed once it exists.
--
-- The basis decides which column carries the figure — `amount_cents` entered
-- directly, or `distance_km` priced at the year's cents-per-kilometre rate — and
-- whether work use can be apportioned, so changing it in place would leave a
-- row whose amount was derived one way and read as another. A deduction on the
-- wrong basis is deleted and added again.

create or replace function public.deduction_basis_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a deduction''s basis cannot be changed; delete it and add it again'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists deduction_basis_immutable on public.deduction;
create trigger deduction_basis_immutable
  before update of basis on public.deduction
  for each row
  when (old.basis is distinct from new.basis)
  execute function public.deduction_basis_immutable();
