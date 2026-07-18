import { useState } from 'react'
import { Button, Stack, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Income, IncomeInput } from '../hooks/useIncomes'
import type { TaxProfile, TaxProfileInput } from '../hooks/useTaxProfiles'
import { IncomeForm } from './IncomeForm'
import { IncomeList } from './IncomeList'
import { TaxProfileForm } from './TaxProfileForm'

interface IncomeScreenProps {
  members: Member[]
  incomes: Income[]
  taxProfiles: TaxProfile[]
  financialYear: number
  onCreateIncome: (input: IncomeInput) => Promise<void>
  onUpdateIncome: (id: string, input: IncomeInput) => Promise<void>
  onDeleteIncome: (id: string) => Promise<void>
  onUpsertTaxProfile: (input: TaxProfileInput) => Promise<void>
}

/** Presentational income + tax-profile management. Persistence lives in the caller. */
export function IncomeScreen({
  members,
  incomes,
  taxProfiles,
  financialYear,
  onCreateIncome,
  onUpdateIncome,
  onDeleteIncome,
  onUpsertTaxProfile,
}: IncomeScreenProps) {
  const [editing, setEditing] = useState<Income | null>(null)
  const [adding, setAdding] = useState(false)

  const closeForm = () => {
    setEditing(null)
    setAdding(false)
  }

  return (
    <Stack gap="xl">
      <Stack gap="md">
        <Title order={2}>Incomes</Title>
        <IncomeList
          incomes={incomes}
          members={members}
          onEdit={(income) => {
            setEditing(income)
            setAdding(false)
          }}
          onDelete={(id) => void onDeleteIncome(id)}
        />

        {editing ? (
          <IncomeForm
            key={editing.id}
            members={members}
            initial={editing}
            onSubmit={async (input) => {
              await onUpdateIncome(editing.id, input)
              closeForm()
            }}
            onCancel={closeForm}
          />
        ) : adding ? (
          <IncomeForm
            members={members}
            onSubmit={async (input) => {
              await onCreateIncome(input)
              closeForm()
            }}
            onCancel={closeForm}
          />
        ) : (
          <Button fullWidth onClick={() => setAdding(true)}>
            Add income
          </Button>
        )}
      </Stack>

      <Stack gap="md">
        <Title order={2}>Tax profiles (FY{financialYear})</Title>
        {members.map((member) => (
          <TaxProfileForm
            key={member.id}
            member={member}
            initial={taxProfiles.find((profile) => profile.member_id === member.id)}
            onSubmit={onUpsertTaxProfile}
          />
        ))}
      </Stack>
    </Stack>
  )
}
