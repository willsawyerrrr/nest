import { useState } from 'react'

interface HomeScreenProps {
  householdName: string
  inviteCode: string
  email: string
  onSignOut: () => void
}

/** Presentational signed-in home. Supabase wiring lives in the caller. */
export function HomeScreen({ householdName, inviteCode, email, onSignOut }: HomeScreenProps) {
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="home">
      <h1>{householdName}</h1>
      <p>Signed in as {email}</p>
      <p>
        Invite code: <strong>{inviteCode}</strong>{' '}
        <button type="button" onClick={copyCode}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
      <p>Share this code with your partner so they can join your household.</p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  )
}
