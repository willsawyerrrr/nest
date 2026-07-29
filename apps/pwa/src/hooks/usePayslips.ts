import { useCallback, useMemo } from 'react'
import { financialYearForDate } from '@nest/tax'
import type { Tables } from '../lib/database.types'
import {
  EXTRACTION_FAILED_MESSAGE,
  readExtraction,
  readExtractionFailure,
  type ExtractionOutcome,
} from '../lib/payslipExtraction'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'
import type { PayslipLineInput } from './usePayslipLines'

export type PayslipRow = Tables<'payslip'>

/**
 * The payslip fields a form supplies for a member; the household is set by the
 * hook and `financial_year` is derived by the form from `paid_on`, or from
 * `period_end` where the slip states no payment date. The database holds that same
 * rule as a check constraint, so a figure derived any other way is rejected rather
 * than filed under the wrong year. The attached document is uploaded before the row
 * is written, and its object key is recorded in `file_path`.
 */
export interface PayslipInput {
  member_id: string
  financial_year: number
  period_start: string
  period_end: string
  paid_on: string | null
  gross_cents: number
  tax_withheld_cents: number
  super_cents: number
  net_cents: number
  salary_sacrifice_cents: number | null
  ytd_gross_cents: number | null
  ytd_tax_withheld_cents: number | null
  ytd_super_cents: number | null
  note: string | null
}

/**
 * A payslip document already in the bucket: the payslip id it is filed under and
 * the object key it landed at. The id travels with the path because the upload
 * happens before the row exists — the document is what extraction reads, so it
 * has to be stored first — and the row must then be written under that same id
 * for the path to sit inside its own prefix.
 */
export interface PayslipAttachment {
  payslipId: string
  path: string
}

/**
 * What a payslip form saves: the id it saves under, the row's fields, the slip's
 * earnings and tax lines, and the document uploaded for it, if any. A null
 * `attachment` leaves any existing attachment as it is; `lines` is the slip's
 * whole set, an empty list leaving it unitemised.
 *
 * The id is the form's own, minted when it opened and unchanged however many
 * times the member presses Save: a slip being edited keeps its id, and a new one
 * is written under the id its document is already filed against. That is what
 * makes a retry after a failed save rewrite the same slip rather than adding a
 * second one alongside it.
 */
export interface PayslipSubmission {
  id: string
  input: PayslipInput
  lines: readonly PayslipLineInput[]
  attachment: PayslipAttachment | null
}

/**
 * The document side of a payslip, which runs ahead of the row: the member picks
 * a slip, it is uploaded, and only then can it be read. Extraction takes an
 * object path, and the file is the auditable record whether or not the read
 * succeeds, so the upload is never deferred to the save.
 */
export interface PayslipAttachments {
  /** Uploads a chosen slip under `payslipId` and returns where it landed. */
  upload: (payslipId: string, file: File) => Promise<PayslipAttachment>
  /**
   * Deletes an uploaded object no payslip references — one the member cleared,
   * replaced, or walked away from. Best effort: a failure leaves an unreferenced
   * object behind, which is not worth failing the form over.
   */
  discard: (path: string) => Promise<void>
  /** Reads an uploaded slip through `payslip-extract` so the form can pre-fill. */
  read: (path: string) => Promise<ExtractionOutcome>
}

/** The private Storage bucket payslip documents live in. */
const PAYSLIPS_BUCKET = 'payslips'

/** How long an attachment's signed URL stays valid, in seconds (one hour). */
const SIGNED_URL_TTL_SECONDS = 3600

export interface UsePayslipsResult {
  payslips: PayslipRow[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  /**
   * Writes a payslip and its lines together, under the id the submission carries
   * — a new slip and an edited one take the same path. The two land in one
   * transaction, so a failure leaves the slip and its lines exactly as they were,
   * and repeating the save rewrites that same slip rather than duplicating it.
   *
   * A new `attachment` replaces the document — recorded first, and only then is
   * the superseded object dropped, best effort, so a delete that fails cannot
   * reject a save already written; without one the existing attachment stands.
   */
  save: (submission: PayslipSubmission) => Promise<void>
  /** Removes a payslip and its stored attachment. */
  remove: (id: string) => Promise<void>
  /** A short-lived signed URL for viewing a stored attachment, or null on failure. */
  signedUrl: (path: string) => Promise<string | null>
  /** Uploading, discarding, and reading the document a form attaches. */
  attachments: PayslipAttachments
}

/**
 * Loads and mutates the household's payslips for `financialYear` (defaulting to
 * the current financial year), most recent pay period first. RLS scopes reads to
 * the household. Attachments sit in the private `payslips` Storage bucket, laid
 * out as `<household_id>/<payslip_id>/<uuid>-<file>` so the first path segment
 * gates access to the owning household.
 */
export function usePayslips(
  householdId: string,
  financialYear: number = financialYearForDate(new Date()),
): UsePayslipsResult {
  const { rows, loading, reload, remove } = useHouseholdCollection<'payslip', never>(householdId, {
    table: 'payslip',
    match: { financial_year: financialYear },
    // Ordered by pay period, not by the payment date the year is filed by: every
    // row carries a period end, so it orders the list totally, while `paid_on` is
    // optional and a descending sort would float the slips lacking one to the top.
    // Within one filed year the two advance together anyway, and a back-pay slip
    // paid late sorts beside the period it covers rather than above the year.
    orderBy: 'period_end',
    descending: true,
    // A save writes the slip's lines in the same call, so the lines collection is
    // refetched alongside this one.
    alsoInvalidate: ['payslip_line'],
  })

  const uploadFile = useCallback(
    async (payslipId: string, file: File): Promise<PayslipAttachment> => {
      const path = `${householdId}/${payslipId}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from(PAYSLIPS_BUCKET).upload(path, file)
      if (error) {
        throw error
      }
      return { payslipId, path }
    },
    [householdId],
  )

  const removeFile = useCallback(async (path: string | null) => {
    if (path === null) {
      return
    }
    const { error } = await supabase.storage.from(PAYSLIPS_BUCKET).remove([path])
    if (error) {
      throw error
    }
  }, [])

  const discardFile = useCallback(
    async (path: string) => {
      try {
        await removeFile(path)
      } catch {
        // An object nobody references is litter, not a failure the member can
        // act on, so cleaning up never surfaces as a form error.
      }
    },
    [removeFile],
  )

  const readUploaded = useCallback(async (path: string): Promise<ExtractionOutcome> => {
    const { data, error, response } = await supabase.functions.invoke<unknown>('payslip-extract', {
      body: { path },
    })
    if (error) {
      // A non-2xx carries the function's own specific message as JSON; a
      // transport failure carries no response at all.
      const body = response ? await response.json().catch(() => null) : null
      return readExtractionFailure(body)
    }
    // A 2xx body is read rather than trusted, so a reply the form cannot render
    // reads as a plain failure instead of throwing partway through the note.
    const extraction = readExtraction(data)
    return extraction === null
      ? { status: 'failed', message: EXTRACTION_FAILED_MESSAGE }
      : { status: 'read', extraction }
  }, [])

  const attachments = useMemo<PayslipAttachments>(
    () => ({ upload: uploadFile, discard: discardFile, read: readUploaded }),
    [uploadFile, discardFile, readUploaded],
  )

  const storedPath = useCallback(
    (id: string) => rows?.find((row) => row.id === id)?.file_path ?? null,
    [rows],
  )

  const savePayslip = useCallback(
    async ({ id, input, lines, attachment }: PayslipSubmission) => {
      const superseded = storedPath(id)
      const { error } = await supabase.rpc('upsert_payslip_with_lines', {
        // An absent path leaves the document already filed against the slip in
        // place, which is what a save carrying no new attachment means.
        p_payslip: { ...input, id, household_id: householdId, file_path: attachment?.path ?? null },
        p_lines: lines.map((line) => ({ ...line })),
      })
      if (error) {
        throw error
      }
      // The row already points at the new object, so dropping the old one is
      // tidying, not part of the save: it cannot fail the save that has
      // happened, and it never touches the path the row now holds — which is
      // what `superseded` reads as once a save is repeated over its own result.
      if (attachment && superseded !== null && superseded !== attachment.path) {
        await discardFile(superseded)
      }
      await reload()
    },
    [householdId, storedPath, discardFile, reload],
  )

  const removePayslip = useCallback(
    async (id: string) => {
      await removeFile(storedPath(id))
      await remove(id)
    },
    [remove, removeFile, storedPath],
  )

  const signedUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage
      .from(PAYSLIPS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error) {
      return null
    }
    return data.signedUrl
  }, [])

  return {
    payslips: rows,
    financialYear,
    loading,
    reload,
    save: savePayslip,
    remove: removePayslip,
    signedUrl,
    attachments,
  }
}
