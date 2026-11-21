/**
 * The daily notification evaluator. One caller reaches it: a `pg_cron` schedule
 * (`20260905000000_notification_triggers.sql`) that POSTs once a day with the
 * service-role key and no user. The default JWT posture (`verify_jwt = true`)
 * has the gateway validate that key's signature before the handler runs; the
 * handler then checks the `role` claim, so only the cron — never a member's
 * JWT — starts an evaluation.
 *
 * It reads every household's plan with a service-role client (the cron caller
 * has no `auth.uid()` for the households' own RLS to match), evaluates the
 * triggers with the pure `@nest/plan` / `@nest/tax` engines, and pushes to each
 * member who has a device, has left the trigger on, and has not already been
 * told, through the delivery loop and service-role wiring `up-sync` and
 * `up-webhook` share (`_shared/notify.ts`, `_shared/notifyClient.ts`). Either
 * send path — Web Push or APNs — may be unconfigured: its devices are skipped,
 * and the run only refuses when neither is.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { loadBudgetSummaryBundle, readHouseholdTable } from '../_shared/householdBuffer.ts'
import {
  deliveryDeps,
  loadSenders,
  readUpCategories,
  readUpHandles,
  REVIEW_TRANSACTION_COLUMNS,
} from '../_shared/notifyClient.ts'
import { REVIEW_BACKSTOP_DAYS, type ReviewTransactionRow } from '../_shared/transactionReview.ts'
import { isServiceRoleToken } from '../up-sync/auth.ts'
import {
  type AccountBalanceRow,
  type AccountOwnerRow,
  type BudgetLineRow,
  type GiftPurchaseRow,
  type GiftTransactionDismissalRow,
  type HouseholdBundle,
  type MemberConnectionRow,
  NEW_GIFT_CANDIDATE_WINDOW_DAYS,
  runNotifyEval,
  type SavingsGoalRow,
  type TemporaryItemRow,
  type TransactionRow,
  UP_GIFT_CATEGORY,
} from './eval.ts'

/**
 * The household's gift-category transactions that entered the category inside
 * the candidate window — the only rows the gift-candidate trigger can fire for.
 */
async function readGiftTransactions(
  admin: SupabaseClient,
  householdId: string,
): Promise<TransactionRow[]> {
  const since = new Date(Date.now() - NEW_GIFT_CANDIDATE_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await admin
    .from('transactions')
    .select(
      'id, account_id, description, amount_cents, external_category, external_category_since, posted_at',
    )
    .eq('household_id', householdId)
    .eq('external_category', UP_GIFT_CATEGORY)
    .gte('external_category_since', since)
  if (error) throw new Error(`Failed to read transactions: ${error.message}`)
  return (data ?? []) as TransactionRow[]
}

/**
 * The household's categorisable, unreviewed Up transactions first seen within
 * the review backstop window — the only rows the review prompt can fire for.
 */
async function readReviewTransactions(
  admin: SupabaseClient,
  householdId: string,
): Promise<ReviewTransactionRow[]> {
  const since = new Date(Date.now() - REVIEW_BACKSTOP_DAYS * 86_400_000).toISOString()
  const { data, error } = await admin
    .from('transactions')
    .select(REVIEW_TRANSACTION_COLUMNS)
    .eq('household_id', householdId)
    .eq('source', 'up')
    .eq('is_categorizable', true)
    .is('reviewed_at', null)
    .gte('created_at', since)
  if (error) throw new Error(`Failed to read transactions: ${error.message}`)
  return (data ?? []) as ReviewTransactionRow[]
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Service-role credentials not configured' }, 500)
  }

  const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!isServiceRoleToken(bearer)) {
    return json({ error: 'Forbidden' }, 403)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const senders = await loadSenders(admin)
  if (!senders.sendPush && !senders.sendApns) {
    return json({ error: 'Push notifications are not configured.' }, 503)
  }
  const upCategories = await readUpCategories(admin)

  const result = await runNotifyEval({
    ...deliveryDeps(admin, senders),
    now: () => new Date(),
    loadHouseholdIds: async () => {
      const { data, error } = await admin.from('members').select('household_id')
      if (error) throw new Error(`Failed to list households: ${error.message}`)
      return [...new Set((data ?? []).map((row) => row.household_id as string))]
    },
    loadBundle: async (householdId, financialYear): Promise<HouseholdBundle> => {
      const [
        base,
        accountBalances,
        giftPurchases,
        transactions,
        accounts,
        giftTransactionDismissals,
        reviewTransactions,
        upHandles,
      ] = await Promise.all([
        loadBudgetSummaryBundle(admin, householdId, financialYear),
        readHouseholdTable(admin, householdId, 'account_balance'),
        readHouseholdTable(admin, householdId, 'gift_purchase'),
        // Only gift-category rows can be candidates; the ledger holds every Up
        // transaction, far more than one read returns.
        readGiftTransactions(admin, householdId),
        readHouseholdTable(admin, householdId, 'accounts'),
        readHouseholdTable(admin, householdId, 'gift_transaction_dismissal'),
        readReviewTransactions(admin, householdId),
        readUpHandles(admin, householdId),
      ])
      return {
        ...base,
        budgetLines: base.budgetLines as BudgetLineRow[],
        savingsGoals: base.savingsGoals as SavingsGoalRow[],
        temporaryItems: base.temporaryItems as TemporaryItemRow[],
        accountBalances: accountBalances as AccountBalanceRow[],
        giftPurchases: giftPurchases as GiftPurchaseRow[],
        transactions,
        accounts: accounts as AccountOwnerRow[],
        giftTransactionDismissals: giftTransactionDismissals as GiftTransactionDismissalRow[],
        // `base.members` already selected `*`, so up_sync_failed_at and name
        // are present even though its narrower TS type doesn't declare them.
        memberConnections: base.members as unknown as MemberConnectionRow[],
        reviewTransactions,
        upHandles,
        upCategories,
      }
    },
  })

  return json(result, 200)
})
