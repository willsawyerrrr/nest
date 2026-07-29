-- Files every payslip under the financial year its pay was PAID in.
--
-- The ATO assesses salary and wages in the year the money is paid, not the year
-- the work that earned it fell in. A payslip's financial year therefore comes from
-- its payment date, falling back to the pay period's last day on a slip that
-- states none — `paid_on` is nullable, and a slip entered without one has nothing
-- better to be filed by.
--
-- What this corrects: every stored row whose recorded `financial_year` differs
-- from that rule — a fortnight worked to 28 June, paid 1 July, and filed under the
-- year the work fell in. Such a row puts the slip's gross and its withheld tax in
-- the wrong year on both sides of the boundary, understating one year's actual
-- withholding and overstating the next's, so the estimate reports the wrong
-- refund or bill in both. Only the differing rows are written, so a row already
-- filed under the year it was paid in — and a row with no payment date, whose
-- period end decides the same year — keeps its `updated_at`. That also makes the
-- sweep idempotent, which the `drop constraint if exists` completes: re-running
-- the whole file writes nothing and errors on nothing.
--
-- The check constraint holds the rule for every future write rather than leaving
-- it a one-off sweep, so no client can file a slip under the year its work fell
-- in. It is the cheap half of making `financial_year` derived: the column stays
-- plain and writable, which keeps `upsert_payslip_with_lines` inserting it and the
-- loader filtering on it, while the database — not the client — decides whether
-- the value is the right one.

create or replace function public.payslip_financial_year(paid_on date, period_end date)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- The AU financial year labelled by its ending year: 1 July opens the year
  -- labelled with the following calendar year, so July onwards counts forward.
  select extract(year from attributed_on)::integer
    + case when extract(month from attributed_on) >= 7 then 1 else 0 end
  from (select coalesce(paid_on, period_end)) as attributed (attributed_on);
$$;

comment on function public.payslip_financial_year(date, date) is 'The AU financial year (ending-year label) a payslip is filed under: the year its payment date falls in, or its pay period''s last day where the slip states none.';

-- A check constraint's expression is evaluated as the writing role, so the PWA
-- needs EXECUTE for its own inserts and updates to pass. Nothing server-side
-- writes payslips, so `service_role` gets no grant, and neither does `anon`.
revoke execute on function public.payslip_financial_year(date, date) from public;
grant execute on function public.payslip_financial_year(date, date) to authenticated;

update public.payslip
  set financial_year = public.payslip_financial_year(paid_on, period_end)
  where financial_year <> public.payslip_financial_year(paid_on, period_end);

alter table public.payslip drop constraint if exists payslip_financial_year;
alter table public.payslip add constraint payslip_financial_year
  check (financial_year = public.payslip_financial_year(paid_on, period_end));

comment on column public.payslip.financial_year is 'AU financial year the pay landed in, labelled by the ending year; derived from paid_on, or from period_end where the slip states no payment date.';
