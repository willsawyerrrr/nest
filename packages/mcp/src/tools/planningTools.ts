import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NestContext } from '../context.ts'
import {
  listMemberAllowances,
  updateMemberAllowance,
  updateMemberAllowanceInput,
} from './allowances.ts'
import {
  addBreakdown,
  addBreakdownInput,
  addBreakdownItem,
  addBreakdownItemInput,
  deleteBreakdown,
  deleteBreakdownInput,
  deleteBreakdownItem,
  deleteBreakdownItemInput,
  listBreakdowns,
  updateBreakdown,
  updateBreakdownInput,
  updateBreakdownItem,
  updateBreakdownItemInput,
} from './breakdowns.ts'
import { deleteBudgetLine, deleteBudgetLineInput } from './budgetLines.ts'
import {
  addSavingsGoal,
  addSavingsGoalInput,
  deleteSavingsGoal,
  deleteSavingsGoalInput,
  reorderSavingsGoalQueue,
  reorderSavingsGoalQueueInput,
  updateSavingsGoal,
  updateSavingsGoalInput,
} from './goals.ts'
import {
  clearPaySplit,
  clearPaySplitInput,
  confirmPaySplit,
  confirmPaySplitInput,
  listPaySplits,
} from './paySplits.ts'
import {
  addTemporaryItem,
  addTemporaryItemInput,
  deleteTemporaryItem,
  deleteTemporaryItemInput,
  listTemporaryItems,
  updateTemporaryItem,
  updateTemporaryItemInput,
} from './temporaryItems.ts'
import {
  deleteWishlistItem,
  deleteWishlistItemInput,
  updateWishlistItem,
  updateWishlistItemInput,
} from './wishlist.ts'

type Respond = (run: () => Promise<unknown>) => Promise<CallToolResult>

const FREQUENCY_NOTE =
  'frequency is weekly, fortnightly, monthly, quarterly, biannual, annual, or every_n_weeks / every_n_months with interval_count.'

/** Registers the budget-planning tools: breakdowns, allowances, goals, temporary items, wishlist edits, and pay splits. */
export function registerPlanningTools(server: McpServer, ctx: NestContext, respond: Respond): void {
  server.registerTool(
    'delete_budget_line',
    {
      description:
        'Delete a manual budget line by id. Lines derived from a breakdown or gifts cannot be deleted here.',
      inputSchema: deleteBudgetLineInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteBudgetLine(ctx, input)),
  )

  server.registerTool(
    'list_breakdowns',
    {
      description:
        'List breakdowns: itemised budgets whose total rolls up into one derived budget line each, with every item and the fortnightly and annual totals in cents.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listBreakdowns(ctx)),
  )

  server.registerTool(
    'add_breakdown',
    {
      description:
        'Create a breakdown (for example medications) in a budget group; add its items with add_breakdown_item. Its total appears as a derived budget line.',
      inputSchema: addBreakdownInput.shape,
    },
    (input) => respond(() => addBreakdown(ctx, input)),
  )

  server.registerTool(
    'update_breakdown',
    {
      description:
        'Rename a breakdown or move it to another budget group; only the fields given change.',
      inputSchema: updateBreakdownInput.shape,
    },
    (input) => respond(() => updateBreakdown(ctx, input)),
  )

  server.registerTool(
    'delete_breakdown',
    {
      description: 'Delete a breakdown with its items and its derived budget line.',
      inputSchema: deleteBreakdownInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteBreakdown(ctx, input)),
  )

  server.registerTool(
    'add_breakdown_item',
    {
      description: `Add an item to a breakdown. amount_cents is a non-negative integer number of cents per frequency; ${FREQUENCY_NOTE}`,
      inputSchema: addBreakdownItemInput.shape,
    },
    (input) => respond(() => addBreakdownItem(ctx, input)),
  )

  server.registerTool(
    'update_breakdown_item',
    {
      description: `Edit a breakdown item by id; only the fields given change. ${FREQUENCY_NOTE}`,
      inputSchema: updateBreakdownItemInput.shape,
    },
    (input) => respond(() => updateBreakdownItem(ctx, input)),
  )

  server.registerTool(
    'delete_breakdown_item',
    {
      description: 'Remove an item from its breakdown.',
      inputSchema: deleteBreakdownItemInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteBreakdownItem(ctx, input)),
  )

  server.registerTool(
    'list_member_allowances',
    {
      description:
        'List each member spending allowance: amount, cadence, fortnightly and annual cents, and the account that funds it.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listMemberAllowances(ctx)),
  )

  server.registerTool(
    'update_member_allowance',
    {
      description: `Set a member's spending allowance (the signed-in member's when member is omitted); only the fields given change. amount_cents may be 0. ${FREQUENCY_NOTE} destination_account_id (from the account directory) funds it in the pay splits; null clears it. Refused with allowance_overdrawn when it would fall below what is drawn from it.`,
      inputSchema: updateMemberAllowanceInput.shape,
    },
    (input) => respond(() => updateMemberAllowance(ctx, input)),
  )

  server.registerTool(
    'add_savings_goal',
    {
      description:
        'Create a savings goal. It is queued until a savings or investments budget line funds it (set goal_id on that line). linked_account_id links a synced savings account whose balance supplies the saved amount; annual_interest_bps is the modelled rate in basis points (450 = 4.50%), 0 to 10000; planned_contribution_cents caps the fortnightly amount a queued goal draws.',
      inputSchema: addSavingsGoalInput.shape,
    },
    (input) => respond(() => addSavingsGoal(ctx, input)),
  )

  server.registerTool(
    'update_savings_goal',
    {
      description:
        'Edit a savings goal by id (from list_savings_goals); only the fields given change. Pass null for target_date, linked_account_id, annual_interest_bps, or planned_contribution_cents to clear it.',
      inputSchema: updateSavingsGoalInput.shape,
    },
    (input) => respond(() => updateSavingsGoal(ctx, input)),
  )

  server.registerTool(
    'delete_savings_goal',
    {
      description: 'Delete a savings goal. Budget lines that funded it remain, unlinked.',
      inputSchema: deleteSavingsGoalInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteSavingsGoal(ctx, input)),
  )

  server.registerTool(
    'reorder_savings_goal_queue',
    {
      description:
        'Order the queued savings goals: goal_ids lists them first to last, and each takes its position in that order.',
      inputSchema: reorderSavingsGoalQueueInput.shape,
    },
    (input) => respond(() => reorderSavingsGoalQueue(ctx, input)),
  )

  server.registerTool(
    'list_temporary_items',
    {
      description:
        'List temporary items: fortnightly outflows (cents) that run until their target date.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listTemporaryItems(ctx)),
  )

  server.registerTool(
    'add_temporary_item',
    {
      description:
        'Add a temporary item: contribution_cents (integer cents) put aside each fortnight until target_date (YYYY-MM-DD).',
      inputSchema: addTemporaryItemInput.shape,
    },
    (input) => respond(() => addTemporaryItem(ctx, input)),
  )

  server.registerTool(
    'update_temporary_item',
    {
      description: 'Edit a temporary item by id; only the fields given change.',
      inputSchema: updateTemporaryItemInput.shape,
    },
    (input) => respond(() => updateTemporaryItem(ctx, input)),
  )

  server.registerTool(
    'delete_temporary_item',
    {
      description: 'Delete a temporary item.',
      inputSchema: deleteTemporaryItemInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteTemporaryItem(ctx, input)),
  )

  server.registerTool(
    'update_wishlist_item',
    {
      description:
        'Edit a wishlist item by id (from list_wishlist); only the fields given change. Pass null for member or note to clear it.',
      inputSchema: updateWishlistItemInput.shape,
    },
    (input) => respond(() => updateWishlistItem(ctx, input)),
  )

  server.registerTool(
    'delete_wishlist_item',
    {
      description: 'Delete a wishlist item.',
      inputSchema: deleteWishlistItemInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteWishlistItem(ctx, input)),
  )

  server.registerTool(
    'list_pay_splits',
    {
      description:
        'The account pay lands in and the fortnightly split (cents) confirmed as set in Up for each account.',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listPaySplits(ctx)),
  )

  server.registerTool(
    'confirm_pay_split',
    {
      description:
        'Record the fortnightly split (integer cents) the household has set in Up for an account, replacing any earlier confirmation.',
      inputSchema: confirmPaySplitInput.shape,
    },
    (input) => respond(() => confirmPaySplit(ctx, input)),
  )

  server.registerTool(
    'clear_pay_split',
    {
      description: "Clear an account's confirmed pay split.",
      inputSchema: clearPaySplitInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => clearPaySplit(ctx, input)),
  )
}
