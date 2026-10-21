import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NestContext } from '../context.ts'
import {
  addTrade,
  addTradeInput,
  createTradesFromContent,
  createTradesFromDocument,
  createTradesFromDocumentInput,
  createTradesFromDocumentRemoteInput,
  deleteTrade,
  deleteTradeInput,
  listHoldings,
  listHoldingsInput,
  listTrades,
  listTradesInput,
  updateTrade,
  updateTradeInput,
} from './trades.ts'

/** Registers the trade tools. */
export function registerTradeTools(
  server: McpServer,
  ctx: NestContext,
  transport: 'stdio' | 'http',
  respond: (run: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
  server.registerTool(
    'list_trades',
    {
      description:
        'List share and ETF trades, newest first, optionally for one member (name) or ticker. Units are decimal; prices are integer microdollars (millionths of a dollar); fees are integer cents.',
      inputSchema: listTradesInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listTrades(ctx, input)),
  )

  server.registerTool(
    'list_holdings',
    {
      description:
        'List current holdings derived from all trades (FIFO per member and ticker): units, cost base and value in cents at the last traded price, plus any units sold beyond recorded buys.',
      inputSchema: listHoldingsInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listHoldings(ctx, input)),
  )

  server.registerTool(
    'add_trade',
    {
      description:
        'Record a share or ETF buy or sell. units is positive with up to six decimal places; price_per_unit_microdollars is the exact unit price in integer microdollars excluding brokerage ($33.083072 is 33083072); fee_cents is brokerage including GST. member (a name) defaults to the signed-in member.',
      inputSchema: addTradeInput.shape,
    },
    (input) => respond(() => addTrade(ctx, input)),
  )

  server.registerTool(
    'update_trade',
    {
      description: 'Edit a trade by id (from list_trades); only the fields given change.',
      inputSchema: updateTradeInput.shape,
    },
    (input) => respond(() => updateTrade(ctx, input)),
  )

  server.registerTool(
    'delete_trade',
    {
      description: 'Delete a trade by id (from list_trades). Holdings and gains recalculate.',
      inputSchema: deleteTradeInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteTrade(ctx, input)),
  )

  const tradeNote =
    'is stored, read by AI (PDF, JPEG, PNG, GIF, WebP only), and every trade on it is recorded for member (default: the signed-in member) and linked to the document. A document that does not fully show every trade records nothing; check the recorded trades against it, and note any possible_duplicates.'
  if (transport === 'stdio') {
    server.registerTool(
      'create_trades_from_document',
      {
        description: `Record the trades on a local broker contract note, confirmation, or statement. The file at file_path (up to 25 MB) ${tradeNote}`,
        inputSchema: createTradesFromDocumentInput.shape,
      },
      (input) => respond(() => createTradesFromDocument(ctx, input)),
    )
  } else {
    server.registerTool(
      'create_trades_from_document',
      {
        description: `Record the trades on a broker contract note, confirmation, or statement sent as base64 content with its filename (up to 3 MB decoded). The file ${tradeNote}`,
        inputSchema: createTradesFromDocumentRemoteInput.shape,
      },
      (input) => respond(() => createTradesFromContent(ctx, input)),
    )
  }
}
