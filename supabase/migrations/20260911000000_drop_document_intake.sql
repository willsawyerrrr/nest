-- Drop document intake: the Shortcuts-based path for getting a payslip or
-- deduction receipt into Nest from outside the PWA.
--
-- Reviewing a staged upload is no different from picking a file by hand, so
-- nothing downstream of this drop needs to change: a payslip or deduction is
-- always added from its own form. A member with a live intake token loses it
-- (the Shortcut it fed has nowhere to post), and a file still staged for review
-- is dropped with the bucket — it was never a payslip or deduction, and is
-- re-added from the ordinary form like any other file.

drop function if exists public.create_document_intake_token();
drop function if exists public.revoke_document_intake_token();

drop table if exists public.document_intake;
drop table if exists public.document_intake_token;

do $$
begin
  if to_regnamespace('storage') is not null then
    drop policy if exists "household members read staged document objects" on storage.objects;
    drop policy if exists "household members delete staged document objects" on storage.objects;

    -- storage.objects and storage.buckets each guard direct deletes
    -- (`storage.protect_delete`) to catch accidental data loss from orphaned
    -- objects; the guard is lifted for these two statements alone. Staged files
    -- go first: a bucket cannot be dropped while an object still references it.
    set local storage.allow_delete_query = 'true';
    delete from storage.objects where bucket_id = 'document-intake';
    delete from storage.buckets where id = 'document-intake';
  end if;
end $$;
