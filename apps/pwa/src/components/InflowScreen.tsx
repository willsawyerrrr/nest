import { Stack, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Inflow, InflowInput } from '../hooks/useInflows'
import { InflowList } from './InflowList'

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
    <Stack gap="sm">
      <Title order={2} visibleFrom="sm">
        Inflows
      </Title>
      <InflowList
        inflows={inflows}
        members={members}
        onCreate={onCreateInflow}
        onUpdate={onUpdateInflow}
        onDelete={(id) => void onDeleteInflow(id)}
      />
    </Stack>
  )
}
