import { useState, type FormEvent } from 'react'

interface OnboardingScreenProps {
  onCreate: (name: string, memberName: string) => void | Promise<void>
}

/** Presentational household-creation form. Supabase wiring lives in the caller. */
export function OnboardingScreen({ onCreate }: OnboardingScreenProps) {
  const [name, setName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && memberName.trim() !== '' && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onCreate(name.trim(), memberName.trim())
    } catch {
      setError('Could not create your household. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <main className="onboarding">
      <h1>Create your household</h1>
      <p>Name your household and yourself to get started.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="household-name">Household name</label>
        <input
          id="household-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <label htmlFor="member-name">Your name</label>
        <input
          id="member-name"
          value={memberName}
          onChange={(event) => setMemberName(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Creating…' : 'Create household'}
        </button>
      </form>
    </main>
  )
}
