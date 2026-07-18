interface HomeScreenProps {
  householdName: string
  email: string
  onSignOut: () => void
}

/** Presentational signed-in home. Supabase wiring lives in the caller. */
export function HomeScreen({ householdName, email, onSignOut }: HomeScreenProps) {
  return (
    <main className="home">
      <h1>{householdName}</h1>
      <p>Signed in as {email}</p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  )
}
