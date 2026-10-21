import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NestContext } from '../context.ts'
import {
  attachPayslipDocument,
  attachPayslipDocumentInput,
  attachPayslipDocumentRemoteInput,
  createPayslipFromDocument,
  createPayslipFromDocumentInput,
  createPayslipFromDocumentRemoteInput,
  removePayslipDocument,
  removePayslipDocumentInput,
} from './payslipDocuments.ts'
import {
  createPayslip,
  createPayslipInput,
  deletePayslip,
  deletePayslipInput,
  listPayslips,
  listPayslipsInput,
  updatePayslip,
  updatePayslipInput,
} from './payslips.ts'

/** Registers the payslip tools. */
export function registerPayslipTools(
  server: McpServer,
  ctx: NestContext,
  transport: 'stdio' | 'http',
  respond: (run: () => Promise<unknown>) => Promise<CallToolResult>,
): void {
  const lineNote =
    'lines is the whole set of the slip’s lines: an earning (optional source_inflow_id, the taxable inflow it draws on) or a tax line (tax_component payg or stsl, no inflow); amount_cents may be negative.'
  server.registerTool(
    'list_payslips',
    {
      description:
        'List payslips with their lines, most recent pay period first. Optionally filter by financial_year (the ending year) and member (a name).',
      inputSchema: listPayslipsInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listPayslips(ctx, input)),
  )
  server.registerTool(
    'create_payslip',
    {
      description: `Record a payslip by hand. Dates are YYYY-MM-DD; money is integer cents. The financial year is derived from paid_on, else period_end. ${lineNote}`,
      inputSchema: createPayslipInput.shape,
    },
    (input) => respond(() => createPayslip(ctx, input)),
  )
  server.registerTool(
    'update_payslip',
    {
      description: `Edit a payslip by id; only the fields given change (null clears paid_on, salary_sacrifice_cents, the ytd figures, and note). Lines given replace the set; omitted, they stay. The stored document is kept. ${lineNote}`,
      inputSchema: updatePayslipInput.shape,
    },
    (input) => respond(() => updatePayslip(ctx, input)),
  )
  server.registerTool(
    'delete_payslip',
    {
      description: 'Delete a payslip, its lines, and its stored document.',
      inputSchema: deletePayslipInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deletePayslip(ctx, input)),
  )
  server.registerTool(
    'remove_payslip_document',
    {
      description: 'Remove the document stored against a payslip.',
      inputSchema: removePayslipDocumentInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => removePayslipDocument(ctx, input)),
  )

  const documentNote =
    'any type, stored against the payslip; PDF, JPEG, PNG, GIF, and WebP can be read by AI'
  if (transport === 'stdio') {
    server.registerTool(
      'attach_payslip_document',
      {
        description: `Attach or replace the document of a payslip from the local file at file_path (${documentNote}, up to 25 MB).`,
        inputSchema: attachPayslipDocumentInput.shape,
      },
      (input) => respond(() => attachPayslipDocument(ctx, input)),
    )
    server.registerTool(
      'create_payslip_from_document',
      {
        description: `Create a payslip from the local payslip at file_path (${documentNote}, up to 25 MB). Any figure not given is read from the document; given values win. Lines read from it are returned, not saved: pass lines to save them. Check read values against the document.`,
        inputSchema: createPayslipFromDocumentInput.shape,
      },
      (input) => respond(() => createPayslipFromDocument(ctx, input)),
    )
  } else {
    server.registerTool(
      'attach_payslip_document',
      {
        description: `Attach or replace the document of a payslip, sent as base64 content with its filename (${documentNote}, up to 3 MB decoded).`,
        inputSchema: attachPayslipDocumentRemoteInput.shape,
      },
      (input) => respond(() => attachPayslipDocument(ctx, input)),
    )
    server.registerTool(
      'create_payslip_from_document',
      {
        description: `Create a payslip from a payslip sent as base64 content with its filename (${documentNote}, up to 3 MB decoded). Any figure not given is read from the document; given values win. Lines read from it are returned, not saved: pass lines to save them. Check read values against the document.`,
        inputSchema: createPayslipFromDocumentRemoteInput.shape,
      },
      (input) => respond(() => createPayslipFromDocument(ctx, input)),
    )
  }
}
