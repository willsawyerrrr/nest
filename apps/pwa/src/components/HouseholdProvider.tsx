/* eslint-disable react/only-export-components -- the provider and its hooks are one unit. */
import { createContext, useContext, type PropsWithChildren } from 'react'

interface HouseholdContextValue {
  householdId: string
  timeZone: string
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

/**
 * Makes the signed-in user's household id and timezone available to every hook
 * and screen below it. The whole authenticated tree runs under exactly one
 * household — there is no picker or switcher — so these are single stable values
 * rather than props threaded through every route and collection hook.
 */
export function HouseholdProvider({
  householdId,
  timeZone,
  children,
}: PropsWithChildren<HouseholdContextValue>) {
  return (
    <HouseholdContext.Provider value={{ householdId, timeZone }}>
      {children}
    </HouseholdContext.Provider>
  )
}

function useHousehold(): HouseholdContextValue {
  const household = useContext(HouseholdContext)
  if (household === null) {
    throw new Error('useHouseholdId must be used within a HouseholdProvider')
  }
  return household
}

/** The current household's id. Throws outside a {@link HouseholdProvider}. */
export function useHouseholdId(): string {
  return useHousehold().householdId
}

/**
 * The current household's timezone (`households.timezone`), whose local day
 * decides which budget lines apply today. Throws outside a {@link HouseholdProvider}.
 */
export function useHouseholdTimeZone(): string {
  return useHousehold().timeZone
}
