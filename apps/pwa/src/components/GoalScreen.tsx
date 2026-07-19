import { Stack, Title } from '@mantine/core'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import { GoalList } from './GoalList'

interface GoalScreenProps {
  goals: Goal[]
  lines: BudgetLine[]
  onCreateGoal: (input: GoalInput) => Promise<void>
  onUpdateGoal: (id: string, input: GoalInput) => Promise<void>
  onDeleteGoal: (id: string) => Promise<void>
}

/** Presentational savings-goal management with progress and ETA. Persistence lives in the caller. */
export function GoalScreen({
  goals,
  lines,
  onCreateGoal,
  onUpdateGoal,
  onDeleteGoal,
}: GoalScreenProps) {
  return (
    <Stack gap="md">
      <Title order={2}>Goals</Title>
      <GoalList
        goals={goals}
        lines={lines}
        onCreate={onCreateGoal}
        onUpdate={onUpdateGoal}
        onDelete={(id) => void onDeleteGoal(id)}
      />
    </Stack>
  )
}
