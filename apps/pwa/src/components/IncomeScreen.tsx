import { useState } from 'react'
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
    <main className="income">
      <section>
        <h2>Incomes</h2>
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
          <button type="button" onClick={() => setAdding(true)}>
            Add income
          </button>
        )}
      </section>

      <section>
        <h2>Tax profiles (FY{financialYear})</h2>
        {members.map((member) => (
          <TaxProfileForm
            key={member.id}
            member={member}
            initial={taxProfiles.find((profile) => profile.member_id === member.id)}
            onSubmit={onUpsertTaxProfile}
          />
        ))}
      </section>
    </main>
  )
}
