-- A payslip line states what it is, so a slip's tax is itemised as well as its pay.
--
-- An Australian slip prints its TAX section as two lines that pay different parts
-- of one liability: PAYG income tax, and an STSL component that pays the
-- compulsory study-loan repayment. A real fortnight prints PAYG $1,416.00 and
-- STSL $434.00 under a $1,850.00 total. Held against the whole liability as one
-- lump, an STSL line that is too small hides behind a PAYG line that is too
-- large; held against its own component, each stands on its own the way an
-- earnings line held against its own inflow does.
--
-- So every line carries a `kind`, and the kind decides what the line is measured
-- against:
--
--   * `earning` — measured against the projected inflow it draws on, which it
--     names in `source_inflow_id`, and carrying the ordinary-time-earnings
--     decision the employer super guarantee is charged on.
--   * `tax` — measured against the component of the estimated liability it pays,
--     which it names in `tax_component`: `stsl` against the compulsory HELP
--     repayment, `payg` against the rest.
--
-- The pairing is the schema's rather than the client's: a check constraint holds
-- each kind to the columns that mean anything for it, so no writer can file a tax
-- line against an inflow or leave an earning without its super decision.

-- `create type` takes no `if not exists`, so each is guarded on its own absence:
-- everything else in this file is written to be re-runnable, and a type that
-- errored on a second pass would be the one thing that was not.
do $$
begin
  if to_regtype('public.payslip_line_kind') is null then
    create type public.payslip_line_kind as enum ('earning', 'tax');
  end if;
  if to_regtype('public.payslip_tax_component') is null then
    create type public.payslip_tax_component as enum ('payg', 'stsl');
  end if;
end $$;

comment on type public.payslip_line_kind is 'What one payslip line is: an ''earning'' measured against the inflow it draws on, or a ''tax'' line measured against the component of the liability it pays.';
comment on type public.payslip_tax_component is 'Which part of the estimated liability a tax line pays: ''stsl'' the compulsory HELP/HECS repayment, ''payg'' the income tax and levies that make up the rest.';

-- Every line written before this is an earnings line, which is what the table
-- held; the default states the same thing for a writer that says nothing, since
-- an unqualified line on a slip is an earning.
alter table public.payslip_line
  add column if not exists kind public.payslip_line_kind not null default 'earning',
  add column if not exists tax_component public.payslip_tax_component;

-- A tax line has no ordinary-time earnings to speak of, so the flag is nullable
-- and the constraint below — not a not-null — decides which kind must carry it.
alter table public.payslip_line
  alter column attracts_super drop not null;

comment on column public.payslip_line.kind is 'What the line is, and so what it is measured against: an earnings line against the inflow it draws on, or a tax line against the component of the liability it pays. Defaults to ''earning'', which is what an unqualified line on a slip is.';
comment on column public.payslip_line.tax_component is 'Which part of the estimated liability a tax line pays — ''payg'' the income tax and levies, ''stsl'' the compulsory HELP repayment; null on an earnings line.';
comment on column public.payslip_line.attracts_super is 'Whether an earnings line is ordinary time earnings the employer super guarantee accrues on, snapshotted from its inflow when the line is written; false for an allowance (e.g. on-call) that is taxed but earns no super, and null on a tax line, which earns none by nature.';
comment on column public.payslip_line.source_inflow_id is 'The projected inflow an earnings line draws on; null when the household maps it to none, and always null on a tax line, which is measured against a liability component instead. Many lines may name the same inflow.';
comment on column public.payslip_line.amount_cents is 'The line''s amount in integer cents, as the slip prints it. Signed, unlike the slip''s own totals: an earnings line may be a negative adjustment reversing an overpayment.';
comment on table public.payslip_line is 'One line on a payslip — an earnings line measured against the inflow it draws on, or a tax line measured against the component of the liability it pays.';

-- Each kind is held to the columns that mean anything for it. The `else true`
-- leaves room for a further kind to be added to the enum and state its own
-- pairing here, rather than being rejected by a rule written before it existed.
alter table public.payslip_line drop constraint if exists payslip_line_kind_attribution;
alter table public.payslip_line add constraint payslip_line_kind_attribution check (
  case kind
    when 'earning' then tax_component is null and attracts_super is not null
    when 'tax' then
      source_inflow_id is null and tax_component is not null and attracts_super is null
    else true
  end
);

-- The snapshot is an earnings line's alone: a tax line is left exactly as it was
-- written, so one carrying a super decision is refused by the constraint above
-- rather than quietly repaired into a shape nobody asked for.
create or replace function public.snapshot_payslip_line_attracts_super()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'earning' and new.attracts_super is null then
    new.attracts_super := coalesce(
      (select i.attracts_super from public.inflows i where i.id = new.source_inflow_id),
      true
    );
  end if;
  return new;
end;
$$;
comment on function public.snapshot_payslip_line_attracts_super() is 'Fills an earnings line''s attracts_super from the inflow it draws on when the writer does not state it; a line naming no inflow is ordinary time earnings, and a tax line is left untouched.';
