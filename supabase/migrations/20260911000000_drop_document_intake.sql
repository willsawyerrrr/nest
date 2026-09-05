-- Drop document intake: the Shortcuts-based path for getting a payslip or
-- deduction receipt into Nest from outside the PWA.
--
-- Reviewing a staged upload is no different from picking a file by hand, and
-- the household has no active tokens to migrate, so nothing downstream of this
-- drop needs to change: a payslip or deduction is always added from its own
-- form.

drop function if exists public.create_document_intake_token();
drop function if exists public.revoke_document_intake_token();

drop table if exists public.document_intake;
drop table if exists public.document_intake_token;

do $$
begin
  if to_regnamespace('storage') is not null then
    drop policy if exists "household members read staged document objects" on storage.objects;
    drop policy if exists "household members delete staged document objects" on storage.objects;

    delete from storage.buckets where id = 'document-intake';
  end if;
end $$;
