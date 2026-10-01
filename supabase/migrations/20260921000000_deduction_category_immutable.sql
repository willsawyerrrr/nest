-- A deduction's category is fixed once it exists.
--
-- The category decides which rules a deduction is held to — work-use
-- apportioning, the distance basis, automatic filing into the "Donations"
-- group, and the kind of document its receipt is read as — so changing it in
-- place would leave a row that was validated, grouped, and read under another
-- kind. A deduction entered under the wrong category is deleted and added
-- again.

create or replace function public.deduction_category_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a deduction''s category cannot be changed; delete it and add it again'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists deduction_category_immutable on public.deduction;
create trigger deduction_category_immutable
  before update of category on public.deduction
  for each row
  when (old.category is distinct from new.category)
  execute function public.deduction_category_immutable();
