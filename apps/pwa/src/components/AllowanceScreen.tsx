import { Progress, Stack, Text } from '@mantine/core'
import { fortnightlyCents } from '@nest/plan'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { MemberAllowance } from '../hooks/useMemberAllowances'
import { allowanceChoices, allowanceName, toPlanAllowance } from '../lib/allowances'
import { resolveRoute } from '../lib/budgetLineRoute'
import { formatFrequency } from '../lib/frequency'
import { formatPerFortnight } from '../lib/money'
import { AddButton } from './AddButton'
import { BreakdownPageLayout } from './BreakdownPageLayout'
import { BudgetLineForm } from './BudgetLineForm'
import { BudgetLineItem } from './BudgetLineItem'
import { EmptyState } from './EmptyState'
import { GroupSection } from './GroupSection'
import { MoneyText } from './MoneyText'

interface AllowanceScreenProps {
  memberName: string
  allowance: MemberAllowance
  /** The signed-in member's budget lines; those drawn from their allowance are listed. */
  lines: BudgetLine[]
  goals: { id: string; name: string; linkedAccountId?: string | null }[]
  accounts: { id: string; name: string }[]
  onCreate: (input: BudgetLineInput) => Promise<void>
  onUpdate: (id: string, input: BudgetLineInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

/**
 * The signed-in member's spending allowance and the items drawn from it: what
 * the allowance provides, how much is drawn and left, and add/edit/delete for
 * each drawn item. Reached from the allowance's card on the Budget tab.
 */
export function AllowanceScreen({
  memberName,
  allowance,
  lines,
  goals,
  accounts,
  onCreate,
  onUpdate,
  onDelete,
}: AllowanceScreenProps) {
  const name = allowanceName(memberName)
  const planAllowance = toPlanAllowance(allowance)
  const choices = allowanceChoices([{ name, allowance: planAllowance }], lines, allowance.member_id)
  const allowanceNames = new Map([[allowance.member_id, name]])
  const drawnLines = lines.filter((line) => line.allowance_member_id === allowance.member_id)
  const share = fortnightlyCents(
    allowance.amount_cents,
    allowance.frequency,
    allowance.interval_count ?? undefined,
  )
  const { editingId, adding, startAdding, startEditing, close } = useInlineEditing<true>()
  const { confirm, modal } = useConfirmDelete()
  const drawn = drawnLines.reduce(
    (total, line) =>
      total + fortnightlyCents(line.amount_cents, line.frequency, line.interval_count ?? undefined),
    0,
  )

  return (
    <BreakdownPageLayout backTo="/budget" backLabel="Budget" title={name}>
      <Stack gap={6}>
        <Text size="sm" c="dimmed">
          <MoneyText cents={allowance.amount_cents} span /> {''}
          {formatFrequency(allowance.frequency, allowance.interval_count)} (
          {formatPerFortnight(share)}). Items drawn from it count against it, not on top of it.
        </Text>
        <Progress
          value={share === 0 ? 0 : Math.min(100, (drawn / share) * 100)}
          color="positive"
          size="sm"
          aria-label={`${name} drawn`}
        />
        <Text size="xs" c="dimmed">
          Drawn {formatPerFortnight(drawn)} · Left {formatPerFortnight(Math.max(0, share - drawn))}
        </Text>
      </Stack>

      <GroupSection title="Items" subtotalCents={drawn}>
        {drawnLines.length === 0 && !adding && (
          <EmptyState>Nothing drawn from your allowance yet.</EmptyState>
        )}
        {drawnLines.map((line) =>
          editingId === line.id ? (
            <BudgetLineForm
              key={line.id}
              initial={line}
              goals={goals}
              accounts={accounts}
              allowances={choices}
              onSubmit={async (input) => {
                await onUpdate(line.id, input)
                close()
              }}
              onCancel={close}
            />
          ) : (
            <BudgetLineItem
              key={line.id}
              line={line}
              route={resolveRoute(line, goals, new Map(), allowanceNames)}
              onEdit={() => startEditing(line.id)}
              onDelete={() =>
                confirm({
                  title: 'Delete budget item?',
                  itemLabel: line.name,
                  onConfirm: () => void onDelete(line.id),
                })
              }
            />
          ),
        )}
        {adding ? (
          <BudgetLineForm
            defaultGroup="discretionary"
            defaultAllowanceMemberId={allowance.member_id}
            goals={goals}
            accounts={accounts}
            allowances={choices}
            onSubmit={async (input) => {
              await onCreate(input)
              close()
            }}
            onCancel={close}
          />
        ) : (
          <AddButton label="Add allowance item" onClick={() => startAdding(true)} />
        )}
      </GroupSection>
      {modal}
    </BreakdownPageLayout>
  )
}
