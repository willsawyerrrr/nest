import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { ToolError, type ErrorCode } from '../errors.ts'

interface UpCategoryRow {
  id: string
  name: string
  parent_id: string | null
}

/** Up's category taxonomy: each parent with its children, the only categories assignable. */
export async function listUpCategories(ctx: NestContext) {
  const rows = await selectAll<UpCategoryRow>(ctx, 'up_category')
  const byName = (a: UpCategoryRow, b: UpCategoryRow) => a.name.localeCompare(b.name)
  const categories = rows
    .filter((row) => row.parent_id === null)
    .sort(byName)
    .map((parent) => ({
      id: parent.id,
      name: parent.name,
      children: rows
        .filter((row) => row.parent_id === parent.id)
        .sort(byName)
        .map((child) => ({ id: child.id, name: child.name })),
    }))
  return { categories }
}

export const categoriseTransactionInput = z.object({
  transaction_id: z.uuid(),
  category_id: z.string().trim().min(1).nullable(),
})

/** Each `up-categorise` failure code, as the tool's own code and fixed copy. */
const FAILURES: Record<string, [ErrorCode, string]> = {
  invalid_request: ['invalid_details', 'Give a transaction_id and a category_id, or null.'],
  transaction_not_found: ['not_found', 'No transaction with that id is visible to the member.'],
  up_transaction_not_found: ['not_found', "Up has no such transaction for the member's token."],
  not_up_transaction: ['not_categorisable', 'Only an Up transaction can be recategorised.'],
  not_categorisable: ['not_categorisable', 'Up does not let this transaction be categorised.'],
  unknown_category: ['invalid_category', 'That is not an Up category; see list_up_categories.'],
  parent_category: [
    'invalid_category',
    'That is a parent category; Up assigns only a child category.',
  ],
  up_not_connected: [
    'up_not_connected',
    "The member has not connected Up; they connect it in Nest's Connections.",
  ],
  up_auth_failed: [
    'up_auth_failed',
    "Up rejected the member's token; they reconnect Up in Nest's Connections.",
  ],
  up_rejected: ['up_rejected', 'Up would not accept that category for this transaction.'],
  up_rate_limited: ['up_rate_limited', 'Up is rate limiting requests; try again in a minute.'],
  save_failed: ['save_failed', 'Up took the new category; Nest shows it after its next sync.'],
}

const UNAVAILABLE: [ErrorCode, string] = ['up_unavailable', 'Up could not be reached; try again.']

/**
 * Sets an Up transaction's category, in Up and in Nest, through `up-categorise`
 * with the member's own Up token. `category_id` is an Up child category, or
 * null to clear the category.
 */
export async function categoriseTransaction(
  ctx: NestContext,
  input: z.infer<typeof categoriseTransactionInput>,
) {
  const { data, error } = await ctx.supabase.functions.invoke<unknown>('up-categorise', {
    body: { transaction_id: input.transaction_id, category_id: input.category_id },
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    const body = response instanceof Response ? await response.json().catch(() => null) : null
    const code =
      typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null
    const [toolCode, message] = (typeof code === 'string' && FAILURES[code]) || UNAVAILABLE
    throw new ToolError(toolCode, message)
  }
  const result = data as {
    transaction_id: string
    category_id: string | null
    parent_category_id: string | null
  }
  return {
    transaction_id: result.transaction_id,
    category_id: result.category_id,
    parent_category_id: result.parent_category_id,
  }
}

/** Registers the Up category tools. */
export function registerUpCategoryTools(
  server: McpServer,
  ctx: NestContext,
  respond: (run: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
  server.registerTool(
    'list_up_categories',
    {
      description:
        "List Up's transaction categories: each parent with its children. Only a child id can be given to categorise_transaction; a synced transaction's external_category is one of them.",
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listUpCategories(ctx)),
  )

  server.registerTool(
    'categorise_transaction',
    {
      description:
        "Change an Up transaction's category in Up and in Nest, using the member's own Up token. transaction_id is from list_transactions; category_id is a child id from list_up_categories (e.g. gifts-and-charity, which puts it in the gift inbox), or null to clear it. A transaction Up marks uncategorisable (e.g. a transfer) is refused.",
      inputSchema: categoriseTransactionInput.shape,
    },
    (input) => respond(() => categoriseTransaction(ctx, input)),
  )
}
