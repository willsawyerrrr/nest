-- A deduction can be entered as a distance instead of a direct dollar amount.
--
-- A work-related car expense claimed under the ATO's cents-per-kilometre method
-- is naturally a distance travelled, not a dollar figure the household would
-- otherwise have to compute by hand. So a deduction states its `basis`: the
-- default `amount`, entered directly as before, or `distance`, entered as
-- `distance_km` kilometres and converted to `amount_cents` at save time using
-- that financial year's published cents-per-km rate
-- (`@nest/tax`'s `carExpenseDeductionCents`).
--
-- `amount_cents` stays the single source of truth every downstream reader (the
-- tax estimate, the EOFY summary) uses: a distance-basis row's `amount_cents` is
-- computed and stored once, when the member saves, the same snapshot-at-write
-- pattern `payslip_line.attracts_super` follows so a later change to the ATO
-- rate cannot retroactively move a deduction already claimed.
--
-- A check constraint holds each basis to its own column, mirroring the
-- `payslip_line_kind_attribution` pairing constraint.

do $$
begin
  if to_regtype('public.deduction_basis') is null then
    create type public.deduction_basis as enum ('amount', 'distance');
  end if;
end $$;

comment on type public.deduction_basis is 'How a deduction''s amount_cents was arrived at: ''amount'', entered directly, or ''distance'', computed from distance_km at the financial year''s cents-per-km car expense rate.';

alter table public.deduction
  add column if not exists basis public.deduction_basis not null default 'amount',
  add column if not exists distance_km numeric(8, 2);

comment on column public.deduction.basis is 'Whether amount_cents was entered directly (''amount'', the default) or computed from distance_km (''distance'') at the financial year''s cents-per-km car expense rate.';
comment on column public.deduction.distance_km is 'Work-related kilometres travelled, for a deduction claimed under the ATO''s cents-per-kilometre car expense method; null unless basis = ''distance''. amount_cents is still the stored, authoritative deduction amount — this is the distance it was computed from.';

alter table public.deduction drop constraint if exists deduction_basis_attribution;
alter table public.deduction add constraint deduction_basis_attribution check (
  case basis
    when 'distance' then distance_km is not null and distance_km >= 0
    when 'amount' then distance_km is null
    else true
  end
);
