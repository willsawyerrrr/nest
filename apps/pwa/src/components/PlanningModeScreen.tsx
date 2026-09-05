import { PageSection } from './PageSection'
import { PlanningModeControl } from './PlanningModeControl'

/** Presentational planning-mode settings: the sandbox on/off control. */
export function PlanningModeScreen() {
  return (
    <PageSection title="Planning mode">
      <PlanningModeControl />
    </PageSection>
  )
}
