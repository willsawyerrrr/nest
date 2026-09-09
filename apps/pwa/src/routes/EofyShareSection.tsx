import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Center, Stack, Title } from '@mantine/core'
import { configsByYear } from '@nest/tax'
import { EmptyState } from '../components/EmptyState'
import { EofyScreen, type EofyPayslipDocument } from '../components/EofyScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useEofyShareData } from '../hooks/useEofyShareData'
import { paygWithheldFromRows, payslipCountByMember } from '../lib/payslips'
import { supabase } from '../lib/supabase'
import {
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  projectedInterestIncomeInputs,
  superCapSummaryFromRows,
} from '../lib/tax'

const SHARE_DISCLAIMER_NOTE =
  'These figures are estimates for planning purposes, not a filed tax return.'

type ShareFileBucket = 'receipts' | 'payslips'

/**
 * Signs a short-lived Storage URL for one file this share links to, via the
 * public `eofy-share-file` function — the same token-scoped path
 * `useDeductionReceipts`/`usePayslips`' own `signedUrl` plays for an
 * authenticated household, but resolved from the share token rather than an
 * RLS-scoped session.
 */
async function eofyShareFileUrl(
  token: string,
  bucket: ShareFileBucket,
  path: string,
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('eofy-share-file', {
    body: { token, bucket, path },
  })
  if (error || !data) {
    return null
  }
  return data.url
}

/** A full-page message in place of the summary, for a loading, invalid, or expired share. */
function EofyShareMessage({ children }: { children: string }) {
  return (
    <Center h="100dvh" px="md">
      <Stack align="center" gap="xs" maw={420}>
        <Title order={2} ta="center" size="h4">
          EOFY summary
        </Title>
        <EmptyState>{children}</EmptyState>
      </Stack>
    </Center>
  )
}

/**
 * The public share view a tax agent opens: the household's EOFY summary for
 * one financial year, read from a validated share token rather than a
 * Supabase session. Composes `useEofyShareData`'s rows through the same pure
 * `lib/tax.ts`/`lib/payslips.ts` functions `EofySection.tsx` uses, so the
 * shared view mirrors the authenticated tab by construction, then renders the
 * same presentational `EofyScreen` with its tab links and edit-elsewhere
 * affordances turned off.
 */
export function EofyShareSection() {
  const { token = '' } = useParams<{ token: string }>()
  const outcome = useEofyShareData(token)

  const signedUrl = useCallback(
    (path: string) => eofyShareFileUrl(token, 'receipts', path),
    [token],
  )
  const payslipSignedUrl = useCallback(
    (path: string) => eofyShareFileUrl(token, 'payslips', path),
    [token],
  )

  if (outcome.status === 'loading') {
    return <LoadingScreen />
  }

  if (outcome.status === 'error') {
    return <EofyShareMessage>{outcome.message}</EofyShareMessage>
  }

  const { data } = outcome
  const config = configsByYear[data.financialYear] ?? currentTaxConfig()
  const estimate = estimateHouseholdTaxFromRows(
    data.inflows,
    data.taxProfiles,
    data.superContributions,
    data.helpDebts,
    data.deductions,
    config,
    paygWithheldFromRows(data.payslips),
    data.members,
    projectedInterestIncomeInputs(data.savingsGoals, data.accounts, data.members),
  )
  const capSummaries = superCapSummaryFromRows(
    data.inflows,
    data.superProfiles,
    data.superContributions,
    config,
    data.members,
  )
  const helpPayoff = helpPayoffByMember(estimate, data.helpDebts, config)

  const payslipDocuments: EofyPayslipDocument[] = data.payslips.flatMap((payslip) =>
    payslip.file_path
      ? [
          {
            id: payslip.id,
            memberId: payslip.member_id,
            paidOn: payslip.paid_on,
            filePath: payslip.file_path,
          },
        ]
      : [],
  )

  return (
    // `.page` gives this standalone route the same margins, max-width, and
    // safe-area padding HouseholdApp's <main> gives every authenticated
    // route — this route sits outside HouseholdApp entirely, so without it
    // EofyScreen would render edge-to-edge with no shell around it.
    <main className="page">
      <EofyScreen
        members={data.members}
        financialYear={data.financialYear}
        // A single-entry list reuses FinancialYearSelect unmodified as a fixed,
        // non-changeable display — the share is scoped to one financial year.
        availableFinancialYears={[data.financialYear]}
        onFinancialYearChange={() => {}}
        showTabLinks={false}
        disclaimerNote={SHARE_DISCLAIMER_NOTE}
        estimate={estimate}
        capSummaries={capSummaries}
        helpDebts={data.helpDebts}
        helpPayoff={helpPayoff}
        deductions={data.deductions}
        payslipCounts={payslipCountByMember(data.payslips)}
        receipts={data.deductionReceipts}
        signedUrl={signedUrl}
        payslipDocuments={payslipDocuments}
        payslipSignedUrl={payslipSignedUrl}
      />
    </main>
  )
}
