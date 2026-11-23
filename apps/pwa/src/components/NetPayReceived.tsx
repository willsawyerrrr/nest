import { useState } from 'react'
import { Anchor, Group, Stack, Text } from '@mantine/core'
import type {
  MemberNetPay,
  MemberSalaryCredit,
  PayslipCreditMatch,
  SalaryCreditCandidate,
} from '@nest/plan'
import { formatIsoDate } from '../lib/dates'
import { moneyColor } from '../lib/money'
import { MoneyText } from './MoneyText'

/** Credits listed before the rest fold behind "Show all". */
const COLLAPSED_CREDIT_COUNT = 6

const LABEL_STYLE = { letterSpacing: '0.04em' } as const

/** A signed difference spelled out against what it is measured against, coloured by sign. */
function DifferenceText({ cents, against }: { cents: number; against: string }) {
  const color = moneyColor(cents)
  return (
    <Text size="xs" span {...(color !== undefined && { c: color })}>
      <MoneyText span cents={Math.abs(cents)} /> {cents > 0 ? 'more' : 'less'} than {against}
    </Text>
  )
}

/**
 * The Up credit that carried a payslip, measured against the slip's net and the
 * plan's net for the period: the reading that ties a slip to the money that
 * actually landed. A slip no credit was found for says so.
 */
export function PayslipCreditNote({ match }: { match: PayslipCreditMatch }) {
  if (match.status === 'missing') {
    return (
      <Text size="xs" c="warning">
        No matching credit in Up
      </Text>
    )
  }
  return (
    <Stack gap={0}>
      <Text size="xs">
        Landed in Up {formatIsoDate(match.postedOn!)}: <MoneyText span cents={match.amountCents!} />
        {match.status === 'matched' ? (
          <Text span size="xs" c="dimmed">
            {' '}
            — matches the slip’s net
          </Text>
        ) : (
          <>
            {' — '}
            <DifferenceText cents={match.netDifferenceCents!} against="the slip’s net" />
          </>
        )}
      </Text>
      {match.modelledDifferenceCents !== null && match.modelledDifferenceCents !== 0 && (
        <DifferenceText cents={match.modelledDifferenceCents} against="the plan’s net" />
      )}
    </Stack>
  )
}

function CreditRow({
  credit,
  cadenceDays,
}: {
  credit: MemberSalaryCredit
  cadenceDays: number | null
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="xs" fw={500}>
          {formatIsoDate(credit.postedOn)}
          <Text span size="xs" c="dimmed">
            {' · '}
            {credit.payer}
          </Text>
        </Text>
        {credit.payslipId === null && (
          <Text size="xs" c="dimmed">
            No payslip entered
          </Text>
        )}
        {credit.cadenceDrift && (
          <Text size="xs" c="warning">
            {credit.daysSincePrevious} days after the previous pay; paid every {cadenceDays}
          </Text>
        )}
        {credit.amountDrift && (
          <DifferenceText cents={credit.previousDifferenceCents!} against="the previous pay" />
        )}
      </Stack>
      <MoneyText cents={credit.amountCents} size="xs" fw={600} style={{ flexShrink: 0 }} />
    </Group>
  )
}

/**
 * A member's net pay as it landed in Up over the year: the total received, how
 * many of their payslips a credit was found for, and each salary credit most
 * recent first with any drift from the pay cycle or the previous pay. Nothing is
 * shown for a member with no salary credits.
 */
export function MemberNetPayBlock({ netPay }: { netPay: MemberNetPay }) {
  const [showAll, setShowAll] = useState(false)
  if (netPay.credits.length === 0) {
    return null
  }
  const shown = showAll ? netPay.credits : netPay.credits.slice(0, COLLAPSED_CREDIT_COUNT)
  const count = netPay.credits.length
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" style={LABEL_STYLE}>
        Net pay received in Up
      </Text>
      <Text size="xs">
        <MoneyText span cents={netPay.receivedCents} fw={600} /> across{' '}
        {count === 1 ? '1 credit' : `${count} credits`}
        {netPay.payslipCount > 0 && (
          <Text span size="xs" c="dimmed">
            {' · '}
            {netPay.matchedCount} of {netPay.payslipCount} slips matched
          </Text>
        )}
        {netPay.cadenceDays !== null && (
          <Text span size="xs" c="dimmed">
            {' · '}paid every {netPay.cadenceDays} days
          </Text>
        )}
      </Text>
      {shown.map((credit) => (
        <CreditRow key={credit.id} credit={credit} cadenceDays={netPay.cadenceDays} />
      ))}
      {count > COLLAPSED_CREDIT_COUNT && (
        <Anchor
          component="button"
          type="button"
          size="xs"
          onClick={() => setShowAll((each) => !each)}
        >
          {showAll ? 'Show fewer' : `Show all ${count}`}
        </Anchor>
      )}
    </Stack>
  )
}

/**
 * Up salary credits no member can be tied to: joint-account pay from a payer none
 * of the household's payslips matched. Entering one of the payee's slips links
 * the payer, and every credit from it, to them.
 */
export function UnattributedSalaryNote({ credits }: { credits: readonly SalaryCreditCandidate[] }) {
  if (credits.length === 0) {
    return null
  }
  const payers = [...new Set(credits.map((credit) => credit.payer.trim()))].join(', ')
  return (
    <Text size="xs" c="dimmed">
      {credits.length === 1 ? '1 salary credit' : `${credits.length} salary credits`} from {payers}{' '}
      landed in a joint account this year. Add a payslip they carry to link them to whoever was
      paid.
    </Text>
  )
}
