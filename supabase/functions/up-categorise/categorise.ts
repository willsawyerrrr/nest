/**
 * The recategorise flow, with its I/O injected so the decision logic is
 * unit-tested without a network or database. `index.ts` wires the caller's
 * RLS-scoped reads, the Vault token read, the Up PATCH, and the local write.
 */

import { upFailure, type UpFailureCode, upFailureResponse } from '../_shared/upFailure.ts'

/** The stable error codes the function's own checks are reported as. */
export type CategoriseCode =
  | 'invalid_request'
  | 'transaction_not_found'
  | 'not_up_transaction'
  | 'not_categorisable'
  | 'unknown_category'
  | 'parent_category'
  | 'save_failed'
  | 'server_error'

const FAILURES: Record<CategoriseCode, { status: number; error: string }> = {
  invalid_request: {
    status: 400,
    error:
      'Give a transaction_id, or up to 100 transaction_ids, and a category_id (null to clear it).',
  },
  transaction_not_found: { status: 404, error: 'No such transaction.' },
  not_up_transaction: { status: 422, error: 'Only an Up transaction can be recategorised.' },
  not_categorisable: { status: 422, error: 'Up does not let this transaction be categorised.' },
  unknown_category: { status: 422, error: 'That is not an Up category.' },
  parent_category: {
    status: 422,
    error: 'Pick a subcategory: Up assigns only those to a transaction.',
  },
  save_failed: {
    status: 500,
    error: "Up has the new category, but Nest's copy does not. Try again.",
  },
  server_error: { status: 500, error: 'Something went wrong. Try again.' },
}

export interface CategoriseResult {
  status: number
  body: Record<string, unknown>
}

/** The caller's view of a transaction, read under their row-level security. */
export interface VisibleTransaction {
  id: string
  source: string
  external_id: string | null
  is_categorizable: boolean | null
}

/** An `up_category` row. */
export interface StoredCategory {
  id: string
  parent_id: string | null
}

export interface CategoriseDeps {
  /** The caller's own member id, or an error outcome. */
  resolveMember: () => Promise<{ memberId?: string; error?: { status: number; message: string } }>
  /** The transaction as the caller's RLS shows it, or null when hidden or absent. */
  readTransaction: (id: string) => Promise<VisibleTransaction | null>
  /** The `up_category` row with this id, or null. */
  readCategory: (id: string) => Promise<StoredCategory | null>
  /** The member's decrypted Up token, or null when they have not connected Up. */
  tokenFor: (memberId: string) => Promise<string | null>
  /**
   * PATCHes the category on Up with `token`, retrying a rate limit when
   * `retryRateLimit` is set; throws an `UpApiError` on failure.
   */
  categorise: (
    token: string,
    upId: string,
    categoryId: string | null,
    retryRateLimit: boolean,
  ) => Promise<void>
  /** Records the category on the local row; false when it could not. */
  recordCategory: (transactionId: string, categoryId: string | null) => Promise<boolean>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The most transactions one batch request recategorises. */
export const MAX_BATCH = 100

/**
 * Up failures that hold for every transaction the token touches, so a batch
 * stops calling Up once one is seen and reports it for the rest.
 */
const TOKEN_WIDE: ReadonlySet<string> = new Set(['up_auth_failed', 'up_rate_limited'])

/** One transaction's outcome in a batch: `code` is set when it failed. */
export interface BatchItemResult {
  transaction_id: string
  code?: CategoriseCode | UpFailureCode
}

function fail(code: CategoriseCode): CategoriseResult {
  const { status, error } = FAILURES[code]
  return { status, body: { code, error } }
}

function upFail(result: { status: number; body: { code: UpFailureCode; error: string } }) {
  return { status: result.status, body: result.body }
}

/**
 * Sets the category of one Up transaction, or of up to {@link MAX_BATCH} of
 * them, on Up and then on each local row. The caller must be able to see a row
 * under their own RLS; it must be an Up row Up lets its owner categorise, and
 * the category a known child category (or null to clear it). The write uses the
 * caller's own Up token, so Up itself decides whether that token's owner can see
 * the transaction. A lookup that throws is logged and answered `server_error`.
 *
 * `{ transaction_id }` answers the one outcome as its status and code.
 * `{ transaction_ids }` answers `200` with each transaction's outcome in
 * `results`, in request order; see {@link categoriseBatch}.
 */
export async function runCategorise(
  body: unknown,
  deps: CategoriseDeps,
): Promise<CategoriseResult> {
  try {
    return await categorise(body, deps)
  } catch (error) {
    console.error('Recategorising failed:', error)
    return fail('server_error')
  }
}

/** The request's transaction ids and whether it is a batch, or null when malformed. */
function parseIds(input: Record<string, unknown>): { ids: string[]; batch: boolean } | null {
  const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
  if (input.transaction_ids === undefined) {
    return isId(input.transaction_id) ? { ids: [input.transaction_id], batch: false } : null
  }
  const ids = input.transaction_ids
  if (
    input.transaction_id !== undefined || !Array.isArray(ids) || ids.length === 0 ||
    ids.length > MAX_BATCH || !ids.every(isId) || new Set(ids).size !== ids.length
  ) {
    return null
  }
  return { ids, batch: true }
}

async function categorise(body: unknown, deps: CategoriseDeps): Promise<CategoriseResult> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const parsed = parseIds(input)
  const categoryId = input.category_id
  if (
    !parsed ||
    !(categoryId === null || (typeof categoryId === 'string' && categoryId.trim() !== ''))
  ) {
    return fail('invalid_request')
  }

  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  if (parsed.batch) {
    return await categoriseBatch(parsed.ids, categoryId, outcome.memberId, deps)
  }

  const transaction = await deps.readTransaction(parsed.ids[0])
  const refusal = refuse(transaction)
  if (refusal) return fail(refusal)

  let parentId: string | null = null
  if (categoryId !== null) {
    const category = await deps.readCategory(categoryId.trim())
    if (!category) return fail('unknown_category')
    if (category.parent_id === null) return fail('parent_category')
    parentId = category.parent_id
  }
  const category = categoryId === null ? null : categoryId.trim()

  const token = await deps.tokenFor(outcome.memberId)
  if (!token) return upFail(upFailureResponse('up_not_connected'))

  try {
    await deps.categorise(token, transaction!.external_id!, category, false)
  } catch (error) {
    return upFail(upFailure(error, 'categorise'))
  }

  if (!(await deps.recordCategory(transaction!.id, category))) return fail('save_failed')

  return {
    status: 200,
    body: { transaction_id: transaction!.id, category_id: category, parent_category_id: parentId },
  }
}

/** Why a transaction cannot be recategorised, or null when it can. */
function refuse(transaction: VisibleTransaction | null): CategoriseCode | null {
  if (!transaction) return 'transaction_not_found'
  if (transaction.source !== 'up' || !transaction.external_id) return 'not_up_transaction'
  if (transaction.is_categorizable === false) return 'not_categorisable'
  return null
}

/**
 * Recategorises many transactions with one category and one token read. A
 * request-wide failure — an unknown or parent category, or no Up token — is
 * answered as itself, as for a single change. Otherwise each transaction is
 * checked and written in turn: Up is called one transaction at a time, a rate
 * limit retried after Up's own wait, and once a failure that holds for the whole
 * token is seen (a rejected token, or a rate limit those retries did not clear)
 * the remaining transactions report it without another call to Up. One
 * transaction failing otherwise leaves the rest to go ahead.
 */
async function categoriseBatch(
  ids: string[],
  categoryId: string | null,
  memberId: string,
  deps: CategoriseDeps,
): Promise<CategoriseResult> {
  let parentId: string | null = null
  if (categoryId !== null) {
    const category = await deps.readCategory(categoryId.trim())
    if (!category) return fail('unknown_category')
    if (category.parent_id === null) return fail('parent_category')
    parentId = category.parent_id
  }
  const category = categoryId === null ? null : categoryId.trim()

  const token = await deps.tokenFor(memberId)
  if (!token) return upFail(upFailureResponse('up_not_connected'))

  const results: BatchItemResult[] = []
  let stopped: UpFailureCode | null = null
  for (const id of ids) {
    if (stopped) {
      results.push({ transaction_id: id, code: stopped })
      continue
    }
    const transaction = await deps.readTransaction(id)
    const refusal = refuse(transaction)
    if (refusal) {
      results.push({ transaction_id: id, code: refusal })
      continue
    }
    try {
      await deps.categorise(token, transaction!.external_id!, category, true)
    } catch (error) {
      const code = upFailure(error, 'categorise').body.code
      if (TOKEN_WIDE.has(code)) stopped = code
      results.push({ transaction_id: id, code })
      continue
    }
    results.push(
      await deps.recordCategory(id, category)
        ? { transaction_id: id }
        : { transaction_id: id, code: 'save_failed' },
    )
  }

  return { status: 200, body: { category_id: category, parent_category_id: parentId, results } }
}
