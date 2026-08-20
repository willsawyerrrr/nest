-- State that a receipt's file_name is the name chosen for it, not the file's.
--
-- The name is picked as the file is attached: the file's own name, one the
-- member types over it, or `Receipt` where neither is given. It is what every
-- listing of the receipt shows and is retyped in place from the deductions
-- list, so it need never have been a file name at all.
--
-- It labels the row alone. The object keeps the generated key it was uploaded
-- under, `storage_path` holding the household-prefixed path the Storage policy
-- matches on, so naming a receipt moves nothing and re-checks no access.

comment on table public.deduction_receipt is
  'A stored receipt file backing a deduction; the file lives in the private `receipts` Storage bucket and this row records its path and the name it is shown under.';

comment on column public.deduction_receipt.file_name is
  'The label the receipt is shown under, chosen as the file is attached and editable in place: the uploaded file''s own name, one the member typed, or `Receipt` where neither is given. A label alone — it never affects storage_path or the stored object.';
