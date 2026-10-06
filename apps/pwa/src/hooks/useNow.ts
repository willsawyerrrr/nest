import { useState } from 'react'
import { financialYearForDate } from '@nest/tax'

/** The time the calling component first rendered, stable across its re-renders. */
export function useNow(): Date {
  const [now] = useState(() => new Date())
  return now
}

/** The financial year the calling component first rendered in, stable across its re-renders. */
export function useCurrentFinancialYear(): number {
  const [financialYear] = useState(() => financialYearForDate(new Date()))
  return financialYear
}
