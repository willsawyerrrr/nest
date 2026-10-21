import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { NestContext } from '../context.ts'
import {
  addEquityGrant,
  addEquityGrantInput,
  deleteEquityGrant,
  deleteEquityGrantInput,
  listEquityGrants,
  updateEquityGrant,
  updateEquityGrantInput,
} from './equity.ts'
import {
  addInflow,
  addInflowInput,
  deleteInflow,
  deleteInflowInput,
  listInflows,
  updateInflow,
  updateInflowInput,
} from './inflows.ts'
import {
  addSuperContribution,
  addSuperContributionInput,
  deleteSuperContribution,
  deleteSuperContributionInput,
  listSuperContributions,
  listSuperContributionsInput,
  listSuperInput,
  listSuperProfiles,
  setSuperProfile,
  setSuperProfileInput,
  updateSuperContribution,
  updateSuperContributionInput,
} from './superannuation.ts'
import {
  getTaxEstimate,
  getTaxEstimateInput,
  listHelpDebts,
  listTaxProfiles,
  listTaxProfilesInput,
  setHelpDebt,
  setHelpDebtInput,
  setTaxProfile,
  setTaxProfileInput,
} from './tax.ts'

type Respond = (run: () => Promise<unknown>) => Promise<CallToolResult>

const INFLOW_NOTE =
  'An inflow is recurring (give schedule: weekly, fortnightly, monthly, quarterly, biannual, annual, or every_n_weeks / every_n_months with interval_count; amount_cents is per schedule period) or a one-off (give paid_on instead; it carries no cadence fields). Taxable inflows need member and are salary, wage (hourly_rate_cents and hours_per_period instead of amount_cents; recurring only), or other; non-taxable are reimbursement, hobby, gift, or other. Recurring only: pay_schedule / pay_interval_count (the cadence the money lands on when it differs from schedule), starts_on / ends_on, pay_anchor_date, attracts_super (false for an allowance earning no super), arrives_every_pay_period (false for pay arriving in only some periods), and is_joint with member_split_percent (0-100 to the named member) for a recurring taxable other inflow both partners are assessed on. A taxable one-off has one_off_tax_treatment (ordinary default, genuine_redundancy with years_of_service, employment_termination, unused_leave).'

/** Registers the income, tax, super, and equity tools. */
export function registerIncomeTaxTools(server: McpServer, ctx: NestContext, respond: Respond) {
  const FY =
    'financial_year is the AU year labelled by its ending year; the current one by default.'
  const MEMBER = 'member is a name or id; the signed-in member by default.'

  server.registerTool(
    'list_inflows',
    {
      description:
        'List the household inflows, recurring and one-off, taxable and not, with annualised cents for recurring ones. Optionally filter by a case-insensitive part of the name.',
      inputSchema: { name: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listInflows(ctx, input)),
  )
  server.registerTool(
    'add_inflow',
    {
      description: `Add an inflow. ${INFLOW_NOTE}`,
      inputSchema: addInflowInput.shape,
    },
    (input) => respond(() => addInflow(ctx, input)),
  )
  server.registerTool(
    'update_inflow',
    {
      description: `Edit an inflow by id (from list_inflows); only the fields given change. Giving schedule or paid_on switches it between recurring and one-off. Pass null to clear pay_schedule, pay_interval_count, starts_on, ends_on, or pay_anchor_date. ${INFLOW_NOTE}`,
      inputSchema: updateInflowInput.shape,
    },
    (input) => respond(() => updateInflow(ctx, input)),
  )
  server.registerTool(
    'delete_inflow',
    {
      description: 'Delete an inflow by id.',
      inputSchema: deleteInflowInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteInflow(ctx, input)),
  )

  server.registerTool(
    'list_tax_profiles',
    {
      description: `List each member's tax profile (residency, private hospital cover) and date of birth. ${FY}`,
      inputSchema: listTaxProfilesInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listTaxProfiles(ctx, input)),
  )
  server.registerTool(
    'set_tax_profile',
    {
      description: `Set a member's tax profile for a financial year: residency (resident or foreign_resident) and has_private_hospital_cover. Only the fields given change; a new profile starts as a resident without cover. ${MEMBER} ${FY}`,
      inputSchema: setTaxProfileInput.shape,
    },
    (input) => respond(() => setTaxProfile(ctx, input)),
  )
  server.registerTool(
    'list_help_debts',
    {
      description: "List each member's standing HELP/HECS balance in cents.",
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listHelpDebts(ctx)),
  )
  server.registerTool(
    'set_help_debt',
    {
      description: `Set a member's standing HELP/HECS balance in cents (not tied to a financial year). ${MEMBER}`,
      inputSchema: setHelpDebtInput.shape,
    },
    (input) => respond(() => setHelpDebt(ctx, input)),
  )
  server.registerTool(
    'get_tax_estimate',
    {
      description: `The household's estimated tax in cents for a financial year, per member and in total, from the Tax tab's engine over inflows, tax profiles, HELP debts, super contributions, deductions, and recorded trades. It does not net payslip withholding or add savings-goal interest. ${FY}`,
      inputSchema: getTaxEstimateInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => getTaxEstimate(ctx, input)),
  )

  server.registerTool(
    'list_super_profiles',
    {
      description: `List each member's super fund, linked account balance in cents, and when it was last confirmed. ${FY}`,
      inputSchema: listSuperInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listSuperProfiles(ctx, input)),
  )
  server.registerTool(
    'set_super_profile',
    {
      description: `Set a member's super fund name and confirmed balance in cents as of today (creating and linking a manual super account if there is none). fund_name is kept if omitted and cleared if null or empty. ${MEMBER} ${FY}`,
      inputSchema: setSuperProfileInput.shape,
    },
    (input) => respond(() => setSuperProfile(ctx, input)),
  )
  server.registerTool(
    'list_super_contributions',
    {
      description: `List super contributions for a financial year, optionally for one member. ${FY}`,
      inputSchema: listSuperContributionsInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listSuperContributions(ctx, input)),
  )
  server.registerTool(
    'add_super_contribution',
    {
      description: `Add a super contribution. kind is salary_sacrifice, personal_deductible, personal_non_concessional, or spouse (which needs contributor, the other member). mode amount takes amount_cents; mode percent takes percent_bp (basis points of salary). frequency as for inflows, with interval_count for every_n_weeks / every_n_months. ${MEMBER} ${FY}`,
      inputSchema: addSuperContributionInput.shape,
    },
    (input) => respond(() => addSuperContribution(ctx, input)),
  )
  server.registerTool(
    'update_super_contribution',
    {
      description:
        "Edit a super contribution by id (from list_super_contributions); only the fields given change. Switching mode needs the new mode's amount_cents or percent_bp.",
      inputSchema: updateSuperContributionInput.shape,
    },
    (input) => respond(() => updateSuperContribution(ctx, input)),
  )
  server.registerTool(
    'delete_super_contribution',
    {
      description: 'Delete a super contribution by id.',
      inputSchema: deleteSuperContributionInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteSuperContribution(ctx, input)),
  )

  server.registerTool(
    'list_equity_grants',
    {
      description:
        'List startup-equity grants with vested quantity and vested value in cents as of today (options at their gain over the strike, shares at the price per share).',
      annotations: { readOnlyHint: true },
    },
    () => respond(() => listEquityGrants(ctx)),
  )
  server.registerTool(
    'add_equity_grant',
    {
      description: `Add an equity grant of options or shares: quantity, grant_date, cliff_months (12), vesting_period_months (48), vesting_frequency (monthly, quarterly, annual; monthly), strike_price_cents (options only), price_per_share_cents (current fair value per share), price_as_of. ${MEMBER}`,
      inputSchema: addEquityGrantInput.shape,
    },
    (input) => respond(() => addEquityGrant(ctx, input)),
  )
  server.registerTool(
    'update_equity_grant',
    {
      description:
        'Edit an equity grant by id (from list_equity_grants); only the fields given change. Pass null to clear strike_price_cents or price_as_of.',
      inputSchema: updateEquityGrantInput.shape,
    },
    (input) => respond(() => updateEquityGrant(ctx, input)),
  )
  server.registerTool(
    'delete_equity_grant',
    {
      description: 'Delete an equity grant by id.',
      inputSchema: deleteEquityGrantInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => respond(() => deleteEquityGrant(ctx, input)),
  )
}
