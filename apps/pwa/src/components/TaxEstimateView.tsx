import type { HouseholdTaxEstimate } from '@budget/tax'
import { formatCents } from '../lib/money'

interface TaxEstimateViewProps {
  estimate: HouseholdTaxEstimate
  financialYear: number
  memberName: (memberId: string) => string
}

/** One member's or the household's annual and fortnightly gross, tax, and after-tax cells. */
function figures(row: {
  annualGrossCents: number
  annualTaxCents: number
  annualAfterTaxCents: number
  fortnightlyGrossCents: number
  fortnightlyTaxCents: number
  fortnightlyAfterTaxCents: number
}) {
  return (
    <>
      <td>{formatCents(row.annualGrossCents)}</td>
      <td>{formatCents(row.annualTaxCents)}</td>
      <td>{formatCents(row.annualAfterTaxCents)}</td>
      <td>{formatCents(row.fortnightlyGrossCents)}</td>
      <td>{formatCents(row.fortnightlyTaxCents)}</td>
      <td>{formatCents(row.fortnightlyAfterTaxCents)}</td>
    </>
  )
}

/** Presentational household tax estimate: per-member and household annual/fortnightly figures. */
export function TaxEstimateView({ estimate, financialYear, memberName }: TaxEstimateViewProps) {
  if (estimate.annualGrossCents === 0) {
    return (
      <main className="tax">
        <h2>Tax estimate (FY{financialYear})</h2>
        <p>No income to estimate yet. Add income on the Income tab to see a tax estimate.</p>
      </main>
    )
  }

  return (
    <main className="tax">
      <h2>Tax estimate (FY{financialYear})</h2>
      <table className="tax-estimate">
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              Member
            </th>
            <th scope="colgroup" colSpan={3}>
              Annual
            </th>
            <th scope="colgroup" colSpan={3}>
              Fortnightly
            </th>
          </tr>
          <tr>
            <th scope="col">Gross</th>
            <th scope="col">Tax</th>
            <th scope="col">After tax</th>
            <th scope="col">Gross</th>
            <th scope="col">Tax</th>
            <th scope="col">After tax</th>
          </tr>
        </thead>
        <tbody>
          {estimate.members.map((member) => (
            <tr key={member.memberId}>
              <th scope="row">{memberName(member.memberId)}</th>
              {figures(member)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Household</th>
            {figures(estimate)}
          </tr>
        </tfoot>
      </table>
    </main>
  )
}
