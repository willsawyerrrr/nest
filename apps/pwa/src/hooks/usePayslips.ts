import { useCallback } from 'react'
import { financialYearForDate } from '@nest/tax'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'

export type PayslipRow = Tables<'payslip'>

/**
 * The payslip fields a form supplies for a member; the household is set by the
 * hook and `financial_year` is derived from the pay period by the form. The
 * attached document is passed alongside as a `File` — the hook uploads it and
 * records the resulting object key in `file_path`.
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
 * What a payslip form saves: the row's fields and the document newly attached to
 * it, if any. A null `file` leaves any existing attachment as it is.
 */
export interface PayslipSubmission {
  input: PayslipInput
  file: File | null
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
  /** Records a payslip, first uploading `file` as its attachment when one is given. */
  create: (input: PayslipInput, file?: File | null) => Promise<void>
  /**
   * Rewrites a payslip. A new `file` replaces the attachment — uploaded, recorded,
   * and only then is the superseded object removed; without one the existing
   * attachment stands.
   */
  update: (id: string, input: PayslipInput, file?: File | null) => Promise<void>
  /** Removes a payslip and its stored attachment. */
  remove: (id: string) => Promise<void>
  /** A short-lived signed URL for viewing a stored attachment, or null on failure. */
  signedUrl: (path: string) => Promise<string | null>
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
    async (payslipId: string, file: File) => {
      const path = `${householdId}/${payslipId}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from(PAYSLIPS_BUCKET).upload(path, file)
      if (error) {
        throw error
      }
      return path
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

  const storedPath = useCallback(
    (id: string) => rows?.find((row) => row.id === id)?.file_path ?? null,
    [rows],
  )

  const createPayslip = useCallback(
    async (input: PayslipInput, file?: File | null) => {
      // The id is minted here rather than by the database default so the
      // attachment can be filed under it before the row exists.
      const id = crypto.randomUUID()
      const filePath = file ? await uploadFile(id, file) : null
      await create({ ...input, id, file_path: filePath })
    },
    [create, uploadFile],
  )

  const updatePayslip = useCallback(
    async (id: string, input: PayslipInput, file?: File | null) => {
      if (!file) {
        await update(id, input)
        return
      }
      const superseded = storedPath(id)
      await update(id, { ...input, file_path: await uploadFile(id, file) })
      await removeFile(superseded)
    },
    [update, uploadFile, removeFile, storedPath],
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
  }
}
