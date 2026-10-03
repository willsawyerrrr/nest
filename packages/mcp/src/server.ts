import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { NestContext } from './context.ts'
import { fixedError, ToolError } from './errors.ts'
import {
  getFortnightlyBuffer,
  listBudgetLines,
  listSavingsGoals,
  listWishlist,
} from './tools/read.ts'
import {
  addWishlistItem,
  addWishlistItemInput,
  createDeductionFromDocument,
  createDeductionInput,
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
 * runs as the signed-in household member, under row-level security.
 */
export function createServer(ctx: NestContext): McpServer {
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
    'create_deduction_from_document',
    {
      description:
        'Create a tax deduction from a local receipt, invoice, or donation receipt. The file (any type, up to 25 MB) is stored as the deduction receipt and, if readable (PDF, JPEG, PNG, GIF, WebP), read by AI to fill any of description, amount_cents (integer cents) and deduction_date (YYYY-MM-DD) that are not given. Given values override read ones; read values should be checked against the document.',
      inputSchema: createDeductionInput.shape,
    },
    (input) => respond(() => createDeductionFromDocument(ctx, input)),
  )

  return server
}
