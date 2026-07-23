import type { Inflow, InflowInput } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import { InflowList } from './InflowList'
import { PageSection } from './PageSection'

interface InflowScreenProps {
  members: Member[]
  inflows: Inflow[]
  onCreateInflow: (input: InflowInput) => Promise<void>
  onUpdateInflow: (id: string, input: InflowInput) => Promise<void>
  onDeleteInflow: (id: string) => Promise<void>
}

/** Presentational inflow management. Persistence lives in the caller. */
export function InflowScreen({
  members,
  inflows,
  onCreateInflow,
  onUpdateInflow,
  onDeleteInflow,
}: InflowScreenProps) {
  return (
    <PageSection title="Inflows">
      <InflowList
        inflows={inflows}
        members={members}
        onCreate={onCreateInflow}
        onUpdate={onUpdateInflow}
        onDelete={(id) => void onDeleteInflow(id)}
      />
    </PageSection>
  )
}
