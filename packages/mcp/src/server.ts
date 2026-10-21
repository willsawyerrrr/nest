import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { NestContext } from './context.ts'
import { fixedError, ToolError } from './errors.ts'
import {
  addBudgetLine,
  addBudgetLineInput,
  updateBudgetLine,
  updateBudgetLineInput,
} from './tools/budgetLines.ts'
import {
  addGiftPurchase,
  addGiftPurchaseInput,
  deleteGiftPurchase,
  deleteGiftPurchaseInput,
  dismissGiftCandidate,
  dismissGiftCandidateInput,
  listGiftCandidates,
  restoreGiftCandidate,
  restoreGiftCandidateInput,
  updateGiftPurchase,
  updateGiftPurchaseInput,
} from './tools/giftPurchases.ts'
import {
  addGiftBudget,
  addGiftBudgetInput,
  addGiftOccasion,
  addGiftOccasionInput,
  addGiftRecipient,
  addGiftRecipientInput,
  deleteGiftBudget,
  deleteGiftBudgetInput,
  deleteGiftOccasion,
  deleteGiftOccasionInput,
  deleteGiftRecipient,
  deleteGiftRecipientInput,
  listGifts,
  setGiftDiscretionaryBudget,
  setGiftDiscretionaryBudgetInput,
  updateGiftBudget,
  updateGiftBudgetInput,
  updateGiftOccasion,
  updateGiftOccasionInput,
  updateGiftRecipient,
  updateGiftRecipientInput,
} from './tools/gifts.ts'
import {
  getHousehold,
  listAccounts,
  listCategories,
  listCategoriesInput,
  listMembers,
  listTransactions,
  listTransactionsInput,
  setAccountNetWorthExclusion,
  setMemberDateOfBirth,
  setMemberDateOfBirthInput,
  setNetWorthExclusionInput,
  setPayAccount,
  setPayAccountInput,
} from './tools/ledger.ts'
import {
  getFortnightlyBuffer,
  listBudgetLines,
  listSavingsGoals,
  listWishlist,
} from './tools/read.ts'
import {
  addWishlistItem,
  addWishlistItemInput,
  createDeductionFromContent,
  createDeductionFromDocument,
  createDeductionInput,
  createDeductionRemoteInput,
} from './tools/write.ts'

/** Wraps a tool's result, or its failure as `{ code, message }`, as MCP content. */
export async function respond(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run(), null, 2) }] }
  } catch (error) {
    const failure = error instanceof ToolError ? error : fixedError('query_failed')
    return {
      isError: true,
      content: [
        { type: 'text', text: JSON.stringify({ code: failure.code, message: failure.message }) },
      ],
    }
  }
}

/**
 * Builds the Nest MCP server. Money in and out is integer cents. Every tool
 * runs as the signed-in household member, under row-level security. Over
 * `stdio` a deduction's document is a local `file_path`; over `http` it is
 * base64 `content` with a `filename`.
 */
export function createServer(ctx: NestContext, transport: 'stdio' | 'http' = 'stdio'): McpServer {
  const server = new McpServer({ name: 'nest', version: '0.0.0' })

  server.registerTool(
    'list_budget_lines',
    {
      description:
        'List the household budget lines with amounts normalised to fortnightly and annual cents, including any member allowance a line is drawn from. Optionally filter by a case-insensitive part of the name.',
      inputSchema: { name: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listBudgetLines(ctx, input)),
  )

  server.registerTool(
    'add_budget_line',
    {
      description:
        'Add a manual budget line. group is needs, wants, discretionary, savings, or investments; amount_cents is a non-negative integer number of cents per frequency (weekly, fortnightly, monthly, quarterly, biannual, annual, or every_n_weeks / every_n_months with interval_count). management_url optionally links the page for managing the subscription it pays for.',
      inputSchema: addBudgetLineInput.shape,
    },
    (input) => respond(() => addBudgetLine(ctx, input)),
  )

  server.registerTool(
    'update_budget_line',
    {
      description:
        'Edit a manual budget line by id (from list_budget_lines); only the fields given change. Pass management_url null to clear it. Lines derived from a breakdown or gifts cannot be edited here. A line drawn from a member allowance cannot be raised past what the allowance has left.',
      inputSchema: updateBudgetLineInput.shape,
    },
    (input) => respond(() => updateBudgetLine(ctx, input)),
  )

  server.registerTool(
    'list_gifts',
    {
      description:
        "The gift tracker: recipients (household members are permanent recipients), occasions, per-recipient budgets with spent and remaining cents, the ad hoc gifts buffer, unassigned spend, and purchases. Purchases against the signed-in member's own gifts are private: those budgets report private true and null spent and remaining.",
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listGifts(ctx)),
  )

  server.registerTool(
    'list_gift_candidates',
    {
      description:
        'The "From your card" inbox: synced Up gift-category card transactions not yet logged as a purchase or set aside, plus those set aside as not a gift (with their dismissal_id).',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listGiftCandidates(ctx)),
  )

  server.registerTool(
    'add_gift_recipient',
    {
      description:
        'Add an external person to buy gifts for. Household members are already permanent recipients.',
      inputSchema: addGiftRecipientInput.shape,
    },
    (input) => respond(() => addGiftRecipient(ctx, input)),
  )

  server.registerTool(
    'update_gift_recipient',
    {
      description:
        "Rename an external gift recipient by id. A household member's recipient cannot be edited.",
      inputSchema: updateGiftRecipientInput.shape,
    },
    (input) => respond(() => updateGiftRecipient(ctx, input)),
  )

  server.registerTool(
    'delete_gift_recipient',
    {
      description:
        "Delete an external gift recipient by id, with their budgets and those budgets' purchases. A household member's recipient cannot be deleted.",
      inputSchema: deleteGiftRecipientInput.shape,
    },
    (input) => respond(() => deleteGiftRecipient(ctx, input)),
  )

  server.registerTool(
    'add_gift_occasion',
    {
      description:
        'Add a gifting occasion (Christmas, a birthday) with an optional occasion_date (YYYY-MM-DD).',
      inputSchema: addGiftOccasionInput.shape,
    },
    (input) => respond(() => addGiftOccasion(ctx, input)),
  )

  server.registerTool(
    'update_gift_occasion',
    {
      description:
        'Edit a gift occasion by id; only the fields given change. occasion_date null clears the date.',
      inputSchema: updateGiftOccasionInput.shape,
    },
    (input) => respond(() => updateGiftOccasion(ctx, input)),
  )

  server.registerTool(
    'delete_gift_occasion',
    {
      description: 'Delete a gift occasion by id, with its budgets and their purchases.',
      inputSchema: deleteGiftOccasionInput.shape,
    },
    (input) => respond(() => deleteGiftOccasion(ctx, input)),
  )

  server.registerTool(
    'add_gift_budget',
    {
      description:
        "Plan a gift spend (budgeted_amount_cents, non-negative) for a recipient on an occasion, one budget per pair. event_date optionally overrides the occasion's date for this recipient.",
      inputSchema: addGiftBudgetInput.shape,
    },
    (input) => respond(() => addGiftBudget(ctx, input)),
  )

  server.registerTool(
    'update_gift_budget',
    {
      description:
        "Edit a gift budget by id; only the fields given change. event_date null falls back to the occasion's date.",
      inputSchema: updateGiftBudgetInput.shape,
    },
    (input) => respond(() => updateGiftBudget(ctx, input)),
  )

  server.registerTool(
    'delete_gift_budget',
    {
      description: 'Delete a gift budget by id, with its purchases.',
      inputSchema: deleteGiftBudgetInput.shape,
    },
    (input) => respond(() => deleteGiftBudget(ctx, input)),
  )

  server.registerTool(
    'set_gift_discretionary_budget',
    {
      description:
        "Set the household's single ad hoc gifts buffer amount in cents, creating it the first time.",
      inputSchema: setGiftDiscretionaryBudgetInput.shape,
    },
    (input) => respond(() => setGiftDiscretionaryBudget(ctx, input)),
  )

  server.registerTool(
    'add_gift_purchase',
    {
      description:
        "Log a gift purchase with amount_cents, purchased_on (YYYY-MM-DD), and a description. Give gift_budget_id to count it against that budget, ad_hoc true to count it against the ad hoc buffer (recipient_id optionally tags who it was for), or neither to leave it unassigned. transaction_id (from list_gift_candidates) links a card transaction and takes its amount and date. Purchases for the signed-in member's own gifts are refused (private_gift).",
      inputSchema: addGiftPurchaseInput.shape,
    },
    (input) => respond(() => addGiftPurchase(ctx, input)),
  )

  server.registerTool(
    'update_gift_purchase',
    {
      description:
        'Edit a gift purchase by id; only the fields given change. Move it with gift_budget_id, ad_hoc true, or unassigned true; recipient_id (null clears) tags an ad hoc one. A purchase linked to a card transaction keeps its amount and date.',
      inputSchema: updateGiftPurchaseInput.shape,
    },
    (input) => respond(() => updateGiftPurchase(ctx, input)),
  )

  server.registerTool(
    'delete_gift_purchase',
    {
      description: 'Delete a gift purchase by id.',
      inputSchema: deleteGiftPurchaseInput.shape,
    },
    (input) => respond(() => deleteGiftPurchase(ctx, input)),
  )

  server.registerTool(
    'dismiss_gift_candidate',
    {
      description:
        "Set a card transaction from list_gift_candidates aside as not a gift (Up's category also covers charity).",
      inputSchema: dismissGiftCandidateInput.shape,
    },
    (input) => respond(() => dismissGiftCandidate(ctx, input)),
  )

  server.registerTool(
    'restore_gift_candidate',
    {
      description: 'Undo a dismissal by dismissal_id, returning its transaction to the inbox.',
      inputSchema: restoreGiftCandidateInput.shape,
    },
    (input) => respond(() => restoreGiftCandidate(ctx, input)),
  )

  server.registerTool(
    'get_fortnightly_buffer',
    {
      description:
        'The household fortnightly buffer in cents: after-tax income less budget outgoings and savings, as shown on the Summary, with each spending allowance, what is drawn from it, and what remains.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => getFortnightlyBuffer(ctx)),
  )

  server.registerTool(
    'list_savings_goals',
    {
      description:
        'List savings goals with saved and target cents, progress percent, target date, and whether each is active or queued.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listSavingsGoals(ctx)),
  )

  server.registerTool(
    'list_wishlist',
    {
      description: 'List the household wishlist items with their rough cost in cents.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listWishlist(ctx)),
  )

  server.registerTool(
    'add_wishlist_item',
    {
      description:
        'Add an item to the household wishlist. amount_cents is a positive integer number of cents; member (a name) optionally tags whose wish it is.',
      inputSchema: addWishlistItemInput.shape,
    },
    (input) => respond(() => addWishlistItem(ctx, input)),
  )

  server.registerTool(
    'list_accounts',
    {
      description:
        "List the accounts the member can see with balance_cents, type, owner (null for a joint account), and whether each is excluded from net worth. A co-member's spending account shows by name only (balance_visible false, null balance); their savers are not listed.",
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listAccounts(ctx)),
  )

  server.registerTool(
    'set_account_net_worth_exclusion',
    {
      description:
        'Include or exclude an account (by id or name) in net-worth totals. The flag is household-wide and leaves retirement projection and budgeting unchanged.',
      inputSchema: setNetWorthExclusionInput.shape,
    },
    (input) => respond(() => setAccountNetWorthExclusion(ctx, input)),
  )

  server.registerTool(
    'list_members',
    {
      description:
        'List the household members with their id, name, and date of birth where recorded.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listMembers(ctx)),
  )

  server.registerTool(
    'set_member_date_of_birth',
    {
      description:
        "Record any household member's date of birth (member by name or id, date as YYYY-MM-DD), or clear it with null. It sets the rate a one-off termination payment is taxed at.",
      inputSchema: setMemberDateOfBirthInput.shape,
    },
    (input) => respond(() => setMemberDateOfBirth(ctx, input)),
  )

  server.registerTool(
    'get_household',
    {
      description: 'The household name, timezone, and the account its pay lands in.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => getHousehold(ctx)),
  )

  server.registerTool(
    'set_pay_account',
    {
      description:
        'Designate the account (by id or name) the household pay lands in, or clear it with null. Pay splits are recommended for every other routed account.',
      inputSchema: setPayAccountInput.shape,
    },
    (input) => respond(() => setPayAccount(ctx, input)),
  )

  server.registerTool(
    'list_categories',
    {
      description:
        'List the household income and expense categories; archived ones only with include_archived.',
      inputSchema: listCategoriesInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listCategories(ctx, input)),
  )

  server.registerTool(
    'list_transactions',
    {
      description:
        'List ledger transactions visible to the member, newest first (limit default 50, max 200), with signed amount_cents (negative is an outflow). Filter by account (id or name), kind, from / to (YYYY-MM-DD), or external_category (e.g. gifts-and-charity, the synced gift-spend candidates).',
      inputSchema: listTransactionsInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listTransactions(ctx, input)),
  )

  const readingNote =
    'is stored as the deduction receipt and, if readable (PDF, JPEG, PNG, GIF, WebP), read by AI to fill any of description, amount_cents (integer cents) and deduction_date (YYYY-MM-DD) that are not given. Given values override read ones; read values should be checked against the document.'
  if (transport === 'stdio') {
    server.registerTool(
      'create_deduction_from_document',
      {
        description: `Create a tax deduction from a local receipt, invoice, or donation receipt. The file at file_path (any type, up to 25 MB) ${readingNote}`,
        inputSchema: createDeductionInput.shape,
      },
      (input) => respond(() => createDeductionFromDocument(ctx, input)),
    )
  } else {
    server.registerTool(
      'create_deduction_from_document',
      {
        description: `Create a tax deduction from a receipt, invoice, or donation receipt sent as base64 content with its filename (any type, up to 3 MB decoded). The file ${readingNote}`,
        inputSchema: createDeductionRemoteInput.shape,
      },
      (input) => respond(() => createDeductionFromContent(ctx, input)),
    )
  }

  return server
}
