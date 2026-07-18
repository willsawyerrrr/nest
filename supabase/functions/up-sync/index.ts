/**
 * Up Bank sync poll. A backstop to the webhook receiver: on a schedule
 * (pg_cron → this function) or on manual invocation it pulls each member's Up
 * accounts and transactions and upserts them into the household ledger, deduping
 * on (source, external_id). No destructive writes are performed here yet — the
 * DB boundaries are marked as TODOs.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { UpClient, type UpAccount, type UpTransaction } from '../_shared/up.ts'

/** A row shaped for upsert into public.accounts (source = 'up'). */
interface AccountUpsert {
  external_id: string
  name: string
  type: 'transaction' | 'savings' | 'other'
  balance_cents: number
  currency: string
  source: 'up'
}

/** A row shaped for upsert into public.transactions (source = 'up'). */
interface TransactionUpsert {
  external_id: string
  account_external_id: string
  posted_at: string
  amount_cents: number
  description: string
  kind: 'income' | 'expense'
  status: 'pending' | 'settled'
  source: 'up'
}

/** Maps an Up account to a ledger account row. */
function mapAccount(account: UpAccount): AccountUpsert {
  const typeByUp: Record<UpAccount['attributes']['accountType'], AccountUpsert['type']> = {
    TRANSACTIONAL: 'transaction',
    SAVER: 'savings',
    HOME_LOAN: 'other',
  }
  return {
    external_id: account.id,
    name: account.attributes.displayName,
    type: typeByUp[account.attributes.accountType],
    balance_cents: account.attributes.balance.valueInBaseUnits,
    currency: account.attributes.balance.currencyCode,
    source: 'up',
  }
}

/** Maps an Up transaction to a ledger transaction row. */
function mapTransaction(tx: UpTransaction): TransactionUpsert {
  const amountCents = tx.attributes.amount.valueInBaseUnits
  return {
    external_id: tx.id,
    account_external_id: tx.relationships.account.data.id,
    posted_at: tx.attributes.settledAt ?? tx.attributes.createdAt,
    amount_cents: amountCents,
    description: tx.attributes.description,
    kind: amountCents < 0 ? 'expense' : 'income',
    status: tx.attributes.status === 'SETTLED' ? 'settled' : 'pending',
    source: 'up',
  }
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Service-role credentials not configured', { status: 500 })
  }

  // Service-role client bypasses RLS; used only for trusted server-side sync.
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // TODO: Enumerate members with a linked Up token. For each member, read their
  // personal access token from Supabase Vault (a SECURITY DEFINER RPC over
  // vault.decrypted_secrets, callable only by service_role). Placeholder:
  const memberTokens: { memberId: string; token: string }[] = []
  void supabase

  for (const { memberId, token } of memberTokens) {
    const up = new UpClient(token)

    const accounts = (await up.listAccounts()).map(mapAccount)
    const transactions = (await up.listTransactions()).map(mapTransaction)

    // TODO: Upsert `accounts` into public.accounts on conflict (source,
    // external_id). Then resolve each transaction's account_external_id to the
    // local account_id and upsert `transactions` into public.transactions on
    // conflict (source, external_id), attributing member_id = memberId and
    // stamping household_id. Deletions are handled by the webhook receiver.
    void memberId
    void accounts
    void transactions
  }

  return new Response(JSON.stringify({ synced: memberTokens.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
