import { useState, type FormEvent } from 'react'

interface OnboardingScreenProps {
  onCreate: (name: string, memberName: string) => void | Promise<void>
  onJoin: (code: string, memberName: string) => void | Promise<void>
}

type Mode = 'create' | 'join'

/** Presentational onboarding: create a household or join one by invite code. */
export function OnboardingScreen({ onCreate, onJoin }: OnboardingScreenProps) {
  const [mode, setMode] = useState<Mode>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [memberName, setMemberName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const firstField = mode === 'create' ? name : code
  const canSubmit = firstField.trim() !== '' && memberName.trim() !== '' && !submitting

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await onCreate(name.trim(), memberName.trim())
      } else {
        await onJoin(code.trim(), memberName.trim())
      }
    } catch {
      setError(
        mode === 'create'
          ? 'Could not create your household. Please try again.'
          : 'Could not join that household. Check the invite code and try again.',
      )
      setSubmitting(false)
    }
  }

  return (
    <main className="onboarding">
      <h1>{mode === 'create' ? 'Create your household' : 'Join a household'}</h1>
      <p>
        {mode === 'create'
          ? 'Name your household and yourself to get started.'
          : 'Enter the invite code your partner shared with you.'}
      </p>
      <div role="tablist" aria-label="Onboarding mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'create'}
          onClick={() => switchMode('create')}
        >
          Create
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          onClick={() => switchMode('join')}
        >
          Join
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        {mode === 'create' ? (
          <>
            <label htmlFor="household-name">Household name</label>
            <input
              id="household-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </>
        ) : (
          <>
            <label htmlFor="invite-code">Invite code</label>
            <input
              id="invite-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
            />
          </>
        )}
        <label htmlFor="member-name">Your name</label>
        <input
          id="member-name"
          value={memberName}
          onChange={(event) => setMemberName(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmit}>
          {mode === 'create'
            ? submitting
              ? 'Creating…'
              : 'Create household'
            : submitting
              ? 'Joining…'
              : 'Join household'}
        </button>
      </form>
    </main>
  )
}
