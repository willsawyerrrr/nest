interface SignInScreenProps {
  onSignIn: () => void
}

/** Presentational sign-in screen. Wiring to Supabase auth lives in the caller. */
export function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <main className="signin">
      <h1>Personal Budget</h1>
      <p>Track income, tax, spending, and savings for your household.</p>
      <button type="button" onClick={onSignIn}>
        Continue with Google
      </button>
    </main>
  )
}
