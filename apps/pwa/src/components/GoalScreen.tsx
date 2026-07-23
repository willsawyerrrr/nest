import { Alert, Button, Group } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import { GoalList } from './GoalList'
import { PageSection } from './PageSection'

interface GoalScreenProps {
  goals: Goal[]
  lines: BudgetLine[]
  savers: Saver[]
  onCreateGoal: (input: GoalInput) => Promise<void>
  onUpdateGoal: (id: string, input: GoalInput) => Promise<void>
  onDeleteGoal: (id: string) => Promise<void>
  onRefresh: () => void
  refreshing: boolean
  refreshError: string | null
}

/** Presentational savings-goal management with progress and ETA. Persistence lives in the caller. */
export function GoalScreen({
  goals,
  lines,
  savers,
  onCreateGoal,
  onUpdateGoal,
  onDeleteGoal,
  onRefresh,
  refreshing,
  refreshError,
}: GoalScreenProps) {
  return (
    <PageSection title="Goals">
      <Group justify="flex-end">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconRefresh size={16} />}
          onClick={onRefresh}
          loading={refreshing}
        >
          Refresh
        </Button>
      </Group>
      {refreshError && (
        <Alert color="red" variant="light">
          {refreshError}
        </Alert>
      )}
      <GoalList
        goals={goals}
        lines={lines}
        savers={savers}
        onCreate={onCreateGoal}
        onUpdate={onUpdateGoal}
        onDelete={(id) => void onDeleteGoal(id)}
      />
    </PageSection>
  )
}
