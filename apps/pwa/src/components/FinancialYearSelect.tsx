import { Select } from '@mantine/core'

/** The FY picker, offering every financial year with a published tax config. */
export function FinancialYearSelect({
  financialYear,
  availableFinancialYears,
  onChange,
}: {
  financialYear: number
  availableFinancialYears: readonly number[]
  onChange: (financialYear: number) => void
}) {
  return (
    <Select
      label="Financial year"
      w={160}
      allowDeselect={false}
      data={availableFinancialYears.map((year) => ({ value: String(year), label: `FY${year}` }))}
      value={String(financialYear)}
      onChange={(value) => {
        if (value) {
          onChange(Number(value))
        }
      }}
    />
  )
}
