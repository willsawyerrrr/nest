import type { ComboboxData } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import { Constants, type Enums } from './database.types'
import { memberName } from './members'
import type { ReviewTransaction, UpCategory } from './transactionReview'

/** How many transactions the list loads per page, newest first. */
export const TRANSACTION_PAGE_SIZE = 50

/** The category filter value for transactions with no category. */
export const UNCATEGORISED = 'none'

/** What narrows the transaction list; null leaves that dimension unfiltered. */
export interface TransactionFilters {
  /** An account id. */
  account: string | null
  /** The first local date included (`YYYY-MM-DD`). */
  from: string | null
  /** The last local date included (`YYYY-MM-DD`). */
  to: string | null
  kind: Enums<'transaction_kind'> | null
  status: Enums<'transaction_status'> | null
  /** An Up category id — a parent matches its children too — or {@link UNCATEGORISED}. */
  category: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Up's category ids are slugs, so one is safe inside a PostgREST `or` filter. */
const CATEGORY_ID = /^[a-z0-9-]+$/

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return values.find((candidate) => candidate === value) ?? null
}

function matching(pattern: RegExp, value: string | null): string | null {
  return value !== null && pattern.test(value) ? value : null
}

/** The filters a URL's search params name, ignoring any malformed value. */
export function parseTransactionFilters(params: URLSearchParams): TransactionFilters {
  return {
    account: matching(UUID, params.get('account')),
    from: matching(ISO_DATE, params.get('from')),
    to: matching(ISO_DATE, params.get('to')),
    kind: oneOf(Constants.public.Enums.transaction_kind, params.get('kind')),
    status: oneOf(Constants.public.Enums.transaction_status, params.get('status')),
    category: matching(CATEGORY_ID, params.get('category')),
  }
}

/** The search params naming `filters`, omitting each unfiltered dimension. */
export function transactionFilterParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null) {
      params.set(key, value as string)
    }
  }
  return params
}

/** Whether any filter narrows the list. */
export function hasTransactionFilters(filters: TransactionFilters): boolean {
  return Object.values(filters).some((value) => value !== null)
}

/**
 * Who a transaction belongs to: its account owner's name, or `Joint` for a
 * joint account's, naming the partner who made it where Up records one.
 */
export function transactionAttribution(
  members: Member[],
  transaction: Pick<ReviewTransaction, 'member_id' | 'performing_customer_name'>,
): string {
  if (transaction.member_id !== null) {
    return memberName(members, transaction.member_id)
  }
  return transaction.performing_customer_name
    ? `Joint · ${transaction.performing_customer_name}`
    : 'Joint'
}

/**
 * The category filter's choices: `Uncategorised`, then each Up parent category
 * (matching all of its children) followed by its children, both alphabetical.
 */
export function categoryFilterOptions(categories: readonly UpCategory[]): ComboboxData {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return [
    { value: UNCATEGORISED, label: 'Uncategorised' },
    ...categories
      .filter((category) => category.parent_id === null)
      .sort(byName)
      .map((parent) => ({
        group: parent.name,
        items: [
          { value: parent.id, label: `All ${parent.name}` },
          ...categories
            .filter((category) => category.parent_id === parent.id)
            .sort(byName)
            .map((child) => ({ value: child.id, label: child.name })),
        ],
      })),
  ]
}
