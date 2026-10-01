# Bulk upload

Deduction receipts, payslips, and trade documents each take many files at once.
Each surface has a panel above its list: a **Choose** button (multi-select) and a
drop area, for desktop drag-and-drop. No new tables, functions, or migrations: a
file is stored and read as in the single-file flows, and every draft is saved
through the same RPC the single form uses.

## Surfaces

| Surface        | Panel                    | One file becomes           | Saved by                          |
| -------------- | ------------------------ | -------------------------- | --------------------------------- |
| Deductions     | `DeductionReceiptImport` | one deduction draft        | `create_deduction_with_receipt`   |
| Payslips       | `PayslipImport`          | one payslip draft          | `upsert_payslip_with_lines`       |
| Investments    | `TradeDocumentImport`    | a draft per trade on it    | `create_trades_with_document`     |

Replacing or adding the receipt of an existing deduction stays a single-file
control: it targets one record, so there is nothing to batch. Trade documents are
the only surface where one file yields several drafts.

The Add trade card is the single-trade path to the same machinery: it holds its own
`useTradeUploadQueue` (the queue `TradeDocumentImport` uses) and opens one file's
single trade in `TradeForm`. Several files, or one file holding several trades,
hand that same queue to `BulkUploadPanel` with the trade drafts' `renderDraft`, in
place of the form.

A deduction batch is read for one kind at a time (work expense, donation receipt,
tax agent invoice), chosen above the picker; it primes `deduction-extract` and is
each draft's starting category, still editable per draft.

## The queue

`useUploadQueue` holds every file in a batch and drives it; `BulkUploadPanel` renders
it. Each surface supplies its own `upload`, `discard`, `read`, and form.

- **Statuses**: queued, reading, ready, unsupported type, enter by hand, couldn't be
  read, saved. A file over 25 MB, or that fails to store, is "couldn't be read"
  without ever reaching the model.
- **Concurrency**: at most three files are stored and read at once; the next starts
  as one finishes. At most 20 files are open (not yet saved) per panel; the rest of
  an oversized pick is left out with a message.
- **Independence**: a file that fails, is unreadable, or is not the expected
  document never blocks the others. It can be retried (a stored file is not stored
  twice), removed, or turned into a blank draft to fill in by hand.
- **Unsupported types** (anything the model cannot read) are stored and attached
  with a blank draft, as for a single file; the model is not called.
- **Reading off**: `not_configured`, `out_of_credit`, and `key_rejected` (and their
  deduction/payslip equivalents) stop the queue. Files not yet read are marked
  couldn't-be-read with the function's fixed copy, which is shown once above the
  list. Adding files or retrying one starts the queue again.
- **Financial year**: each read sends the current financial year, so a yearless date
  resolves within it, exactly as for single files. A payslip's filing year is derived
  from its own dates.

## Review and saving

Each ready file is a card holding the surface's ordinary form, opened on what was
read. The form's own **Discard** (or **Save**) acts on that draft alone. A discarded
draft deletes its stored file unless a saved record references it.

**Save selected (n)** submits the selected cards' own forms one after another, with a
progress bar and then a summary ("Saved 4. 1 file needs another look"). Each form
validates itself: a draft that is not valid yet, or whose save fails, is not saved,
keeps its inline error, and is marked; the others still save. Saved files stay in the
list as "Saved" until **Done**. **Discard all** deletes every stored file no saved
record references.

## No duplicates on retry

Each file's id is minted when it is added and is the id of the record it becomes (the
deduction, the payslip, the trade document; each trade draft has its own). Saves are
keyed on those ids and idempotent, so a save retried after a network failure rewrites
the same row. A file already read is not read again by a retry; a file already
stored is not stored again. Trade drafts keep the existing warning for a likely
repeat of a saved trade. Deductions and payslips have no repeat warning: the same
document added twice makes two records, as adding it twice by hand would.

## Cleanup

Files are stored before they are read, so a file nobody saves would be litter. A
draft discarded, a file removed, a batch discarded, or a panel left (navigating away)
deletes its stored file unless a saved record references it. The delete is best
effort, and a closed tab runs none of it, as for a single file.
