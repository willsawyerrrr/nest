/* eslint-disable react/only-export-components -- the provider and its hook are one unit. */
import { createContext, useContext, type PropsWithChildren } from 'react'

const HouseholdIdContext = createContext<string | null>(null)

/**
 * Makes the signed-in user's household id available to every hook and screen
 * below it. The whole authenticated tree runs under exactly one household —
 * there is no picker or switcher — so the id is a single stable value rather
 * than a prop threaded through every route and collection hook.
 */
export function HouseholdProvider({
  householdId,
  children,
}: PropsWithChildren<{ householdId: string }>) {
  return <HouseholdIdContext.Provider value={householdId}>{children}</HouseholdIdContext.Provider>
}

/** The current household's id. Throws outside a {@link HouseholdProvider}. */
export function useHouseholdId(): string {
  const householdId = useContext(HouseholdIdContext)
  if (householdId === null) {
    throw new Error('useHouseholdId must be used within a HouseholdProvider')
  }
  return householdId
}
