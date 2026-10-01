-- Cap an uploaded file at 25 MiB in the `receipts` and `payslips` buckets, the
-- same limit the PWA enforces before it uploads. No MIME restriction is set:
-- any type of file may be stored, and the app serves anything that is not a PDF
-- or a raster image as a download rather than rendering it.
--
-- Guarded so the block is skipped wherever the `storage` schema is absent.
do $$
begin
  if to_regnamespace('storage') is not null then
    update storage.buckets
      set file_size_limit = 25 * 1024 * 1024,
          allowed_mime_types = null
      where id in ('receipts', 'payslips');
  end if;
end $$;
