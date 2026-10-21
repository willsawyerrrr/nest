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
