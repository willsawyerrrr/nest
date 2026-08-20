/** What a receipt is stored under when the household chooses no name for it. */
export const DEFAULT_RECEIPT_NAME = 'Receipt'

/**
 * The label a receipt is stored under: the chosen name trimmed, or
 * {@link DEFAULT_RECEIPT_NAME} where nothing was chosen — a name field left
 * empty, or a file carrying no name of its own. Every write of
 * `deduction_receipt.file_name` goes through this, so a stored label is never
 * blank.
 */
export function receiptName(chosen: string): string {
  return chosen.trim() || DEFAULT_RECEIPT_NAME
}
