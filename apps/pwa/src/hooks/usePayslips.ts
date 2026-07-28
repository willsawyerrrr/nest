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

export type PayslipRow = Tables<'payslip'>

/**
 * The payslip fields a form supplies for a member; the household is set by the
 * hook and `financial_year` is derived from the pay period by the form. The
 * attached document is uploaded before the row is written, and its object key is
 * recorded in `file_path`.
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
  source_inflow_id: string | null
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
 * What a payslip form saves: the row's fields and the document uploaded for it,
 * if any. A null `attachment` leaves any existing attachment as it is.
 */
export interface PayslipSubmission {
  input: PayslipInput
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

/** The written row: the form's fields plus the id and object key the hook sets. */
type PayslipWrite = PayslipInput & { id?: string; file_path?: string | null }

/** The private Storage bucket payslip documents live in. */
const PAYSLIPS_BUCKET = 'payslips'

/** How long an attachment's signed URL stays valid, in seconds (one hour). */
const SIGNED_URL_TTL_SECONDS = 3600

export interface UsePayslipsResult {
  payslips: PayslipRow[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  /** Records a payslip under the id its uploaded document is filed against. */
  create: (input: PayslipInput, attachment?: PayslipAttachment | null) => Promise<void>
  /**
   * Rewrites a payslip. A new `attachment` replaces the document — recorded
   * first, and only then is the superseded object dropped, best effort, so a
   * delete that fails cannot reject a save already written; without one the
   * existing attachment stands.
   */
  update: (id: string, input: PayslipInput, attachment?: PayslipAttachment | null) => Promise<void>
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
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'payslip',
    PayslipWrite,
    Partial<PayslipWrite>
  >(householdId, {
    table: 'payslip',
    match: { financial_year: financialYear },
    orderBy: 'period_end',
    descending: true,
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

  const createPayslip = useCallback(
    async (input: PayslipInput, attachment?: PayslipAttachment | null) => {
      // The id is minted with the attachment so the document can be filed under
      // it before the row exists, and here when no document was attached at all.
      const id = attachment?.payslipId ?? crypto.randomUUID()
      await create({ ...input, id, file_path: attachment?.path ?? null })
    },
    [create],
  )

  const updatePayslip = useCallback(
    async (id: string, input: PayslipInput, attachment?: PayslipAttachment | null) => {
      if (!attachment) {
        await update(id, input)
        return
      }
      const superseded = storedPath(id)
      await update(id, { ...input, file_path: attachment.path })
      // The row already points at the new object, so dropping the old one is
      // tidying, not part of the save: it cannot fail the save that has
      // happened, and it never touches the path the row now holds — which is
      // what `superseded` reads as once a save is repeated over its own result.
      if (superseded !== null && superseded !== attachment.path) {
        await discardFile(superseded)
      }
    },
    [update, discardFile, storedPath],
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
    create: createPayslip,
    update: updatePayslip,
    remove: removePayslip,
    signedUrl,
    attachments,
  }
}
