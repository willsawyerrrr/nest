import { useState, type FormEvent } from 'react'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput, TaxResidency } from '../hooks/useTaxProfiles'
import { centsToDollarInput, dollarsToCents } from '../lib/money'

interface TaxProfileFormProps {
  member: Member
  initial?: TaxProfile
  onSubmit: (input: TaxProfileInput) => void | Promise<void>
}

const RESIDENCIES: { value: TaxResidency; label: string }[] = [
  { value: 'resident', label: 'Resident' },
  { value: 'foreign_resident', label: 'Foreign resident' },
]

/** Presentational tax-profile editor for one member. Persistence lives in the caller. */
export function TaxProfileForm({ member, initial, onSubmit }: TaxProfileFormProps) {
  const [residency, setResidency] = useState<TaxResidency>(initial?.residency ?? 'resident')
  const [hasCover, setHasCover] = useState(initial?.has_private_hospital_cover ?? false)
  const [helpDebt, setHelpDebt] = useState(centsToDollarInput(initial?.help_debt_cents))
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const coverId = `tax-cover-${member.id}`
  const residencyId = `tax-residency-${member.id}`
  const helpId = `tax-help-${member.id}`

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSaved(false)
    setError(null)
    try {
      await onSubmit({
        member_id: member.id,
        residency,
        has_private_hospital_cover: hasCover,
        help_debt_cents: helpDebt.trim() === '' ? 0 : dollarsToCents(helpDebt),
      })
      setSaved(true)
    } catch {
      setError('Could not save this tax profile. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="tax-profile-form" onSubmit={handleSubmit}>
      <h3>{member.name}</h3>

      <label htmlFor={residencyId}>Residency</label>
      <select
        id={residencyId}
        value={residency}
        onChange={(event) => setResidency(event.target.value as TaxResidency)}
      >
        {RESIDENCIES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label htmlFor={coverId}>
        <input
          id={coverId}
          type="checkbox"
          checked={hasCover}
          onChange={(event) => setHasCover(event.target.checked)}
        />
        Private hospital cover
      </label>

      <label htmlFor={helpId}>HELP debt ($)</label>
      <input
        id={helpId}
        type="number"
        min="0"
        step="0.01"
        value={helpDebt}
        onChange={(event) => setHelpDebt(event.target.value)}
      />

      {error && <p role="alert">{error}</p>}
      {saved && !error && <p role="status">Saved</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
