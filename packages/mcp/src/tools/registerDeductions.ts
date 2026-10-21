import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NestContext } from '../context.ts'
import {
  createDeductionGroup,
  createDeductionGroupInput,
  deleteDeductionGroup,
  deleteDeductionGroupInput,
  listDeductionGroups,
  listDeductionGroupsInput,
  updateDeductionGroup,
  updateDeductionGroupInput,
} from './deductionGroups.ts'
import {
  addDeduction,
  addDeductionInput,
  attachReceiptFromContent,
  attachReceiptFromFile,
  attachReceiptInput,
  attachReceiptRemoteInput,
  deleteDeduction,
  deleteDeductionInput,
  listDeductions,
  listDeductionsInput,
  removeReceipt,
  removeReceiptInput,
  updateDeduction,
  updateDeductionInput,
} from './deductions.ts'

/** Registers the deduction, receipt, and deduction-group tools. */
export function registerDeductionTools(
  server: McpServer,
  ctx: NestContext,
  transport: 'stdio' | 'http',
  respond: (run: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
  server.registerTool(
    'list_deductions',
    {
      description:
        'List tax deductions for a financial year (default: the current one, labelled by its ending year) with basis, amount, full cost, work use, group, and whether a receipt is stored. Optionally filter by member name or category.',
      inputSchema: listDeductionsInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listDeductions(ctx, input)),
  )

  server.registerTool(
    'add_deduction',
    {
      description:
        "Add a deduction by hand. basis amount (default): amount_cents is the full cost and work_use_percent (work expenses only, default 100) the share claimed. basis distance: distance_km, priced at the financial year's ATO cents-per-km rate. basis hours: work_from_home_hours, priced at the ATO fixed rate. Distance and hours are work expenses only. category is work_expense, donation, or tax_agent_fees; a donation is filed automatically in the donations group. group_id files a non-donation in a standard group of the same member and year. Category and basis cannot be changed later.",
      inputSchema: addDeductionInput.shape,
    },
    (input) => respond(() => addDeduction(ctx, input)),
  )

  server.registerTool(
    'update_deduction',
    {
      description:
        "Edit a deduction by id; only the fields given change and the claimed amount is recomputed from its basis. Pass group_id null to take a non-donation out of its group. A donation's group is automatic.",
      inputSchema: updateDeductionInput.shape,
    },
    (input) => respond(() => updateDeduction(ctx, input)),
  )

  server.registerTool(
    'delete_deduction',
    {
      description: 'Delete a deduction by id, with its stored receipt.',
      inputSchema: deleteDeductionInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteDeduction(ctx, input)),
  )

  if (transport === 'stdio') {
    server.registerTool(
      'attach_deduction_receipt',
      {
        description:
          'Attach the file at file_path (any type, up to 25 MB) as the receipt of an existing deduction, replacing any earlier one. Nothing is read from the file.',
        inputSchema: attachReceiptInput.shape,
      },
      (input) => respond(() => attachReceiptFromFile(ctx, input)),
    )
  } else {
    server.registerTool(
      'attach_deduction_receipt',
      {
        description:
          'Attach a file sent as base64 content with its filename (any type, up to 3 MB decoded) as the receipt of an existing deduction, replacing any earlier one. Nothing is read from the file.',
        inputSchema: attachReceiptRemoteInput.shape,
      },
      (input) => respond(() => attachReceiptFromContent(ctx, input)),
    )
  }

  server.registerTool(
    'remove_deduction_receipt',
    {
      description: "Remove a deduction's receipt and its stored file.",
      inputSchema: removeReceiptInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => removeReceipt(ctx, input)),
  )

  server.registerTool(
    'list_deduction_groups',
    {
      description:
        'List deduction groups for a financial year (default: the current one) with kind (standard, or the automatic donations group), payment count, and summed total in cents.',
      inputSchema: listDeductionGroupsInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listDeductionGroups(ctx, input)),
  )

  server.registerTool(
    'create_deduction_group',
    {
      description:
        "Create a named group for one member's deductions in a financial year (default: the current one), e.g. a subscription paid monthly.",
      inputSchema: createDeductionGroupInput.shape,
    },
    (input) => respond(() => createDeductionGroup(ctx, input)),
  )

  server.registerTool(
    'update_deduction_group',
    {
      description:
        'Rename a standard deduction group. The donations group is automatic and read-only.',
      inputSchema: updateDeductionGroupInput.shape,
    },
    (input) => respond(() => updateDeductionGroup(ctx, input)),
  )

  server.registerTool(
    'delete_deduction_group',
    {
      description:
        'Delete a standard deduction group; its payments stay as ungrouped deductions. The donations group cannot be deleted.',
      inputSchema: deleteDeductionGroupInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteDeductionGroup(ctx, input)),
  )
}
